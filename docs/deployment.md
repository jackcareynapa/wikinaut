# Deploying the Wikinaut backend (Fly.io)

The Wikinaut backend is the forked `sdow` Flask API. It answers `POST /paths` (shortest-path
queries) and `GET /ok` (health check) over the Wikipedia link graph stored in a single SQLite file
(`sdow.sqlite`, ~5 GB for English Wikipedia). The userscript talks to this API.

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
  (`links.*`, sorted, grouped, `with_counts`) plus the ~5 GB final SQLite and its `.gz`, so budget
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
gsutil cp dump/sdow.sqlite gs://<your-bucket>/sdow.sqlite
```

## Step 3 — Create the Fly app and volume

Install [flyctl](https://fly.io/docs/flyctl/install/), then from the repo root:

```bash
fly auth login
fly apps create wikinaut-api          # must match `app` in fly.toml (and the userscript default)
fly volumes create wikinaut_data --size 6 --region iad   # >= your sdow.sqlite size, same region as fly.toml
fly deploy                            # builds the Dockerfile and boots one machine
```

The first boot has no database yet, so the health check will fail until Step 4 — that's expected.

## Step 4 — Load the database onto the volume

SSH into the machine and pull the graph onto `/data`, then seed an (empty) searches database from
the bundled schema:

```bash
fly ssh console
# inside the machine:
cd /data
apt-get update && apt-get install -y wget        # or use gsutil if you staged on GCS
wget -O sdow.sqlite "https://storage.googleapis.com/<your-bucket>/sdow.sqlite"
sqlite3 /data/searches.sqlite < /app/sql/createSearchesTable.sql
exit
```

> Alternative for the ~5 GB transfer: `fly sftp shell` from the machine that has the file, then
> `put dump/sdow.sqlite /data/sdow.sqlite`.

Restart so the app picks up the database:

```bash
fly machine restart
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
