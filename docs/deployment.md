# Deploying the Wikinaut backend (Fly.io)

The Wikinaut backend is the forked `sdow` Flask API. It answers `POST /paths` (shortest-path
queries) and `GET /ok` (health check) over the Wikipedia link graph stored in a single SQLite file
(`sdow.sqlite`, ~14 GB for English Wikipedia). The userscript talks to this API.

This guide deploys it to **Fly.io** as an always-on container with the graph on a **persistent
volume**. Serverless platforms (Vercel, Lambda, etc.) cannot host it: there is no persistent
multi-gigabyte disk and the process must stay resident.

You provide the SQLite graph; the repo provides the `Dockerfile` and `fly.toml`.

## How the container finds the database

The image (see [`Dockerfile`](../Dockerfile)) contains only the code. The databases live on the
volume mounted at `/data`. `server.py` opens `./sdow.sqlite` / `./searches.sqlite` relative to its
working directory, so gunicorn is launched with:

```
gunicorn --chdir /data --pythonpath /app --bind 0.0.0.0:8080 --workers 2 sdow.server:app
```

`--chdir /data` makes the relative DB paths resolve onto the volume, `--pythonpath /app` keeps the
`sdow` package importable, and binding the bare `sdow.server:app` (rather than
`load_app("prod")`) skips Google Cloud logging, which would otherwise require GCP credentials. No
code changes are needed.

## Step 1 — Build the graph on a GCE VM

Building the graph downloads multi-gigabyte Wikipedia dumps and processes them; it needs a
high-memory machine and lots of scratch disk, and takes a couple of hours. (See
[`data-source.md`](./data-source.md) for the full pipeline and the all-important `linktarget`
schema note.)

**Sizing it** (figures from the 2026-06-01 enwiki dump): the downloads total ~11 GB compressed
(`pagelinks` ~7.0 GB, `page` ~2.4 GB, `linktarget` ~1.4 GB, `redirect` ~0.2 GB). Two things drive
the machine spec:
- **RAM** — the `linktarget` join (`replace_link_targets_in_links_file.py`) holds the whole
  namespace-0 link-target map in memory (tens of millions of entries, roughly **4–7 GB resident**),
  and `buildDatabase.sh` runs `sort -S 80%` which wants buffer space. **32 GB is comfortable, 64 GB
  is generous.** 16 GB works but sort spills to disk and it's tight.
- **Disk** — the dumps are only ~11 GB, but the pipeline *keeps every* multi-GB intermediate
  (`links.*`, sorted, grouped, `with_counts`) plus the ~14 GB final SQLite and its `.gz`, so budget
  **~200 GB SSD**.

1. Create a Compute Engine VM — **`e2-highmem-8`** (8 vCPU / 64 GB) for a faster build, or
   **`e2-highmem-4`** (4 vCPU / 32 GB) for a cheaper one-off — with a **200 GB+ SSD** (`pd-ssd` or
   `pd-balanced`) and a recent Debian.
2. SSH in and install dependencies:
   ```bash
   sudo apt-get -q update
   sudo apt-get -yq install git pigz sqlite3 python3 aria2
   ```
3. Clone and build (use `screen`/`tmux` so a dropped connection doesn't kill the build):
   ```bash
   git clone https://github.com/jackcareynapa/wikinaut.git
   cd wikinaut/scripts
   ./buildDatabase.sh            # or ./buildDatabase.sh <YYYYMMDD> for a specific dump
   ```
   This produces `wikinaut/scripts/dump/sdow.sqlite`.

## Step 2 — Stage the graph somewhere reachable

From the GCE VM, copy the file to a Google Cloud Storage bucket (or any URL the Fly machine can
reach):

```bash
gsutil cp dump/sdow.sqlite gs://wikinaut-dumps/wikinaut.sqlite
```

> Note the object name (`wikinaut.sqlite`) differs from the filename the app opens (`sdow.sqlite`);
> Step 4 renames it on the way onto the volume.

## Step 3 — Create the Fly app and volume

Install [flyctl](https://fly.io/docs/flyctl/install/), then from the repo root:

```bash
fly auth login
fly apps create wikinaut-api          # must match `app` in fly.toml (and the userscript default)
fly volumes create wikinaut_data --size 25 --region sjc   # region MUST match fly.toml's primary_region; size >= ~1.5x the DB (WAL + searches.sqlite headroom)
fly deploy                            # builds the Dockerfile and boots one machine
```

The first boot has no database yet, so the health check will fail until Step 4 — that's expected.

## Step 4 — Load the database onto the volume

⚠️ **Cold-start chicken-and-egg:** `server.py` opens *both* `sdow.sqlite` and `searches.sqlite` at
import, so on an empty volume every worker crashes ~7 s after boot and the machine sits `stopped` —
and `fly ssh console` can't attach to a stopped machine. So keep a machine alive with a no-op command
first, load the data, then restore the real command. The runtime image is `python:3.12-slim` — **no
`wget`, `curl`, or `sqlite3` CLI** — so use `python3` for everything.

**1. Keep the machine alive** (machine ID from `fly status`):

```bash
fly machine update <machine-id> -C "sleep infinity" --yes && fly machine start <machine-id>
```

**2. Make the graph reachable from Fly.** Fastest is a server-side download straight from GCS
(Google→Fly; your laptop isn't in the path). The object is private and the bucket has Public Access
Prevention, so open it for the load and lock it back down afterwards:

```bash
gsutil pap set unspecified gs://wikinaut-dumps
gsutil iam ch allUsers:objectViewer gs://wikinaut-dumps
curl -sI https://storage.googleapis.com/wikinaut-dumps/wikinaut.sqlite | head -1   # expect "HTTP/2 200"
```

**3. Download onto the volume as `sdow.sqlite`** (note the rename from the bucket's `wikinaut.sqlite`)
and seed an empty searches DB. The download is resumable — re-running continues from the partial
file; **never put a GCP token on the Fly host**:

```bash
fly ssh console -a wikinaut-api
# on the machine:
python3 - <<'PY'
import urllib.request, os, time
url = "https://storage.googleapis.com/wikinaut-dumps/wikinaut.sqlite"
dst = "/data/sdow.sqlite.part"
TOTAL = int(urllib.request.urlopen(urllib.request.Request(url, method="HEAD")).headers["Content-Length"])
size = lambda: os.path.getsize(dst) if os.path.exists(dst) else 0
while size() < TOTAL:
    try:
        r = urllib.request.urlopen(urllib.request.Request(url, headers={"Range": f"bytes={size()}-"}), timeout=60)
        with r, open(dst, "ab" if (size() == 0 or r.status == 206) else "wb") as f:   # 206 required to append
            while (b := r.read(8388608)):
                f.write(b)
    except Exception as e:
        print("retry:", e); time.sleep(2)
os.replace(dst, "/data/sdow.sqlite")                                  # atomic rename to what the app opens
import sqlite3                                                        # seed empty searches.sqlite
c = sqlite3.connect("/data/searches.sqlite")
c.executescript(open("/app/sql/createSearchesTable.sql").read()); c.commit(); c.close()
PY
exit
```

> No-exposure alternative (skip step 2): stream it through the SSH tunnel with your locally-authed
> gsutil — `gsutil cp gs://wikinaut-dumps/wikinaut.sqlite - | fly ssh console -C 'cat > /data/sdow.sqlite.part'`,
> then `mv` to `sdow.sqlite`. Slower (bounded by your uplink) and a single 14 GB stream is fragile;
> make it resumable with `gsutil cat -r <offset>-` appends (see `CLAUDE.md`).

**4. Lock the bucket back down:**

```bash
gsutil iam ch -d allUsers:objectViewer gs://wikinaut-dumps
gsutil pap set enforced gs://wikinaut-dumps
```

**5. Restore the real app.** `fly deploy` regenerates the machine config from the Dockerfile CMD,
clearing the `sleep infinity` override and booting gunicorn with both DBs present:

```bash
fly deploy
```

## Step 5 — Verify

```bash
curl https://wikinaut-api.fly.dev/ok
curl -X POST https://wikinaut-api.fly.dev/paths \
  -H 'content-type: application/json' \
  -d '{"source":"Cat","target":"Dog"}'
```

`/ok` should return a JSON timestamp and `/paths` should return a `paths` array.

## Step 6 — Point the userscript at it

The userscript ([`wikinaut.user.js`](../wikinaut.user.js)) already defaults to
`https://wikinaut-api.fly.dev`. If you used a different Fly app name, update the `apiBaseUrl`
constant near the top of the script **and** its `@connect` directive. Anyone can also override the
backend at runtime via the panel's **Settings → Backend URL** field (handy for pointing at a local
`flask run` during development).

## Local container smoke test

You can validate the image without the full graph by mounting the mock database:

```bash
python3 scripts/create_mock_databases.py            # writes sdow/sdow.sqlite + sdow/searches.sqlite
mkdir -p /tmp/wikinaut-data && cp sdow/*.sqlite /tmp/wikinaut-data/
docker build -t wikinaut-api .
docker run --rm -p 8085:8080 -v /tmp/wikinaut-data:/data wikinaut-api
# in another shell:
curl localhost:8085/ok
curl -X POST localhost:8085/paths -H 'content-type: application/json' -d '{"source":"1","target":"6"}'
```
