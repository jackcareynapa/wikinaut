# Wikinaut backend — production web server setup (Fly.io)

The Wikinaut backend is the forked `sdow` Flask API. It answers `POST /paths` (shortest-path
queries) and `GET /ok` (health check) over the Wikipedia link graph stored in a single SQLite file
(`sdow.sqlite`, ~14 GB for English Wikipedia). The userscript talks to this API.

This guide deploys it to **Fly.io** as an always-on container with the graph on a **persistent
volume**. Serverless platforms (Vercel, Lambda, etc.) cannot host it: there is no persistent
multi-gigabyte disk and the process must stay resident.

You provide the SQLite graph; the repo provides the `Dockerfile` and `fly.toml`.

> For **local development** against the tiny mock database (no full graph, no Fly account), see
> [`CONTRIBUTING.md`](../.github/CONTRIBUTING.md). For **building the graph**, see
> [`data-source.md`](./data-source.md).

## Prerequisites

- A Wikipedia link graph built per [`data-source.md`](./data-source.md); the build produces
  `scripts/dump/wikinaut.sqlite`.
- [`flyctl`](https://fly.io/docs/flyctl/install/) installed and authenticated (`fly auth login`).
- A location the Fly machine can fetch the graph from. This guide uses a Google Cloud Storage
  bucket + `gsutil`, but any reachable URL works.

## How the container finds the database

The image (see [`Dockerfile`](../Dockerfile)) contains only the code. The databases live on the
volume mounted at `/data`. `server.py` opens `./sdow.sqlite` / `./searches.sqlite` relative to its
working directory, so gunicorn is launched with:

```
gunicorn --chdir /data --pythonpath /app --bind 0.0.0.0:8080 --workers 2 sdow.server:app
```

`--chdir /data` makes the relative DB paths resolve onto the volume, and `--pythonpath /app` keeps
the `sdow` package importable. No code changes are needed.

## Environment variables

The backend needs **no environment variables** at runtime. Configuration lives in two places:

- **`fly.toml`** — app name, `primary_region`, volume mount, health check, VM size.
- **`Dockerfile` CMD** — the gunicorn flags (`--chdir /data`, `--pythonpath /app`, workers, timeout).

The backend uses Python's standard `logging` module only; there is no remote/GCP logging
integration (an earlier `load_app('prod')` + `google-cloud-logging` path was removed — it was never
exercised in production and only added an unused dependency + boot-time import). `fly logs` /
`fly ssh console` are the way to see server logs. Errors are tagged in the log message where it
matters for triage — e.g. `[sqlite]` prefixes a database-layer failure so it's distinguishable from
an application bug.

## Database location & creation

`server.py` opens `./sdow.sqlite` and `./searches.sqlite` relative to its working directory; with
gunicorn's `--chdir /data`, those resolve to `/data/sdow.sqlite` and `/data/searches.sqlite` on the
mounted volume. Two hard requirements:

- **Both files must exist** before the app can serve. `server.py` opens both at import time, so if
  *either* is missing every worker raises `IOError` ~7 s after boot and the machine crash-loops to
  `stopped`. `searches.sqlite` starts empty (seeded from `sql/createSearchesTable.sql`);
  `sdow.sqlite` is your built graph.
- **The volume's region MUST match `fly.toml`'s `primary_region`** (`sjc`). A machine booting in a
  different region gets a fresh, empty volume instead of your data.

Steps 1–4 build, stage, and load the graph.

## Step 1 — Build the graph

Build the SQLite graph on a high-memory Linux VM following [`data-source.md`](./data-source.md)
(downloads multi-gigabyte Wikipedia dumps, ~2 hours, needs roughly 32 GB RAM + 200 GB SSD). The
build produces **`scripts/dump/wikinaut.sqlite`**.

The rest of this guide only needs that finished file; the full pipeline and sizing details live in
`data-source.md` and are not repeated here.

## Step 2 — Stage the graph somewhere reachable

From the build VM, copy the file to a Google Cloud Storage bucket (or any URL the Fly machine can
reach):

```bash
gsutil cp dump/wikinaut.sqlite gs://wikinaut-dumps/wikinaut.sqlite
```

> The app opens the file as `sdow.sqlite`, but the build output — and this bucket object — is
> `wikinaut.sqlite`. Step 4 renames it to `sdow.sqlite` on the way onto the volume.

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

**Preflight, before you start** (the three things that bite if skipped):
- The volume's region **must match** `fly.toml`'s `primary_region` (`sjc`) — a mismatch boots a
  fresh, empty volume instead of your data.
- **Both** `sdow.sqlite` and `searches.sqlite` must end up on `/data` — either missing crash-loops
  every worker (see the preflight check below).
- The bucket object is `wikinaut.sqlite`; the app opens `sdow.sqlite` — **rename on the way in**
  (step 3 below does this with an atomic `os.replace`, only once the transfer is complete).

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

## Step 4b — Load the CSR link arrays (optional but strongly recommended)

The server prefers serving BFS neighbor lookups from flat, memory-mapped **CSR arrays**
(`/data/csr/*.npy`, ~1.3 GB for English Wikipedia) instead of the pipe-separated strings inside
the 14 GB SQLite file: contiguous binary reads instead of disk-bound B-tree walks plus string
parsing, and the OS page cache shares the arrays between both gunicorn workers. **This step is
safe to skip or defer** — at boot, `CSRGraph.load('./csr')` returns `None` when the arrays are
absent and the app logs one line and falls back to the SQLite links table. That also means the
deploy order is safe: ship the code first, load the arrays whenever.

**1. Build the arrays where the built graph lives** (the Step 1 VM, or any machine with the
finished `wikinaut.sqlite` and numpy installed). Takes tens of minutes, dominated by parsing the
pipe strings:

```bash
cd scripts/
python3 build_csr_graph.py dump/wikinaut.sqlite dump/csr/
```

The build spot-checks 100 random pages against SQLite before declaring success; a mismatch raises
instead of writing a corrupt artifact.

**2. Stage the arrays:**

```bash
gsutil cp dump/csr/*.npy gs://wikinaut-dumps/csr/
```

**3. Download onto the volume.** Same pattern as Step 4 (open the bucket, resumable
`python3`/`urllib` download over `fly ssh console`, lock the bucket back down) — but no rename
this time; the five files keep their names under `/data/csr/`:

```bash
fly ssh console -a wikinaut-api
# on the machine:
python3 - <<'PY'
import urllib.request, os, time
FILES = ["csr_ids.npy", "csr_out_offsets.npy", "csr_out_edges.npy",
         "csr_in_offsets.npy", "csr_in_edges.npy"]
os.makedirs("/data/csr", exist_ok=True)
for name in FILES:
    url = f"https://storage.googleapis.com/wikinaut-dumps/csr/{name}"
    dst = f"/data/csr/{name}.part"
    TOTAL = int(urllib.request.urlopen(urllib.request.Request(url, method="HEAD")).headers["Content-Length"])
    size = lambda: os.path.getsize(dst) if os.path.exists(dst) else 0
    while size() < TOTAL:
        try:
            r = urllib.request.urlopen(urllib.request.Request(url, headers={"Range": f"bytes={size()}-"}), timeout=60)
            with r, open(dst, "ab" if (size() == 0 or r.status == 206) else "wb") as f:
                while (b := r.read(8388608)):
                    f.write(b)
        except Exception as e:
            print(name, "retry:", e); time.sleep(2)
    os.replace(dst, f"/data/csr/{name}")   # atomic: the app never sees a partial file
    print("done:", name)
PY
exit
```

> The `.part` → final rename matters here too: the app treats the arrays as present as soon as
> all five filenames exist, so a partial file under its final name would serve garbage edges.

**4. Restart so the app picks the arrays up** (they're only probed at import):

```bash
fly apps restart wikinaut-api
```

Confirm in `fly logs` — you should see
`Serving links from CSR arrays in ./csr (... pages, ... outgoing / ... incoming links).`
instead of the fallback line. Then run the Step 5 checks.

> **Rebuilds:** the CSR arrays are derived from `sdow.sqlite` — whenever you load a newer graph
> (see "Updating / redeploying"), rebuild and reload the arrays from the *same* dump, or delete
> `/data/csr/` and let the app fall back until you do. Serving mismatched arrays returns paths
> from the older graph.

## Step 5 — Verify

Run this after every deploy (initial load or a redeploy) — the three checks together confirm the
DBs are present, a real query resolves, and request validation is doing its job:

```bash
curl https://wikinaut-api.fly.dev/ok
curl -X POST https://wikinaut-api.fly.dev/paths \
  -H 'content-type: application/json' \
  -d '{"source":"Cat","target":"Dog"}'
curl -i -X POST https://wikinaut-api.fly.dev/paths \
  -H 'content-type: application/json' -d '{}'   # expect HTTP 400, {"code":"bad-request",...}
```

`/ok` should return a JSON timestamp, the `Cat`→`Dog` query should return a `paths` array, and the
malformed request should come back as a `400` (not a `500`) with a `code` field.

## Step 6 — Point the userscript at it

The userscript ([`wikinaut.user.js`](../wikinaut.user.js)) already defaults to
`https://wikinaut-api.fly.dev`. If you used a different Fly app name, update the `apiBaseUrl`
constant near the top of the script **and** its `@connect` directive. Anyone can also override the
backend at runtime via the panel's **Settings → Backend URL** field (handy for pointing at a local
`flask run` during development — see [`CONTRIBUTING.md`](../.github/CONTRIBUTING.md)).

## Process manager / service

There is no separate init system or supervisor inside the container: **gunicorn is PID 1**, launched
by the Dockerfile `CMD` (2 workers, 120 s timeout). **Fly.io is the process supervisor** — `fly.toml`
sets `min_machines_running = 1`, `auto_start_machines = true`, and a `/ok` health check, so Fly keeps
the machine up and restarts it if the check fails or the process dies.

To do maintenance on the volume without gunicorn running (e.g. to load or repair the DB), override
the machine command so it doesn't crash-loop, then restore it afterwards:

```bash
fly machine update <machine-id> -C "sleep infinity" --yes && fly machine start <machine-id>
# ... work on /data ...
fly deploy   # regenerates the machine config from the Dockerfile CMD
```

## Reverse proxy & TLS

Fly's edge proxy terminates TLS and forwards to the container's internal port 8080 (`fly.toml`
`[http_service]`, `internal_port = 8080`). `force_https = true` upgrades HTTP to HTTPS, so the public
endpoint is `https://<app>.fly.dev`. You do **not** need to run your own nginx/Caddy. The app also
enables permissive CORS (`flask-cors`), though the userscript reaches the API via `GM_xmlhttpRequest`
(which sidesteps CORS anyway).

## Security notes

- **Never put a GCP access token on the Fly host.** Loading the graph uses either a server-side
  public download (bucket opened only for the load, then locked back down) or a stream through your
  locally-authed `gsutil` — see Step 4. A token on the host is credential leakage and is blocked
  besides.
- **Lock the bucket back down** after loading (Step 4.4): remove `allUsers:objectViewer` and
  re-enforce Public Access Prevention.
- The API is unauthenticated and read-only over a public dataset — there is nothing secret in it. To
  curb abuse, put it behind Fly's rate limiting or a token check (out of scope here).

## Logs

```bash
fly logs                    # live tail
fly logs -a wikinaut-api    # explicit app
```

A crash-loop from a missing database shows as the machine cycling to `stopped` shortly after each
boot (see [Database location & creation](#database-location--creation)).

## Backups

The graph is fully reproducible from the Wikipedia dump (rebuild per
[`data-source.md`](./data-source.md)), so the volume isn't precious — but you can snapshot it:

```bash
fly volumes list
fly volumes snapshots list <volume-id>
fly volumes snapshots create <volume-id>
```

`searches.sqlite` (the historical search log) is the only non-reproducible data, and it isn't
required to run the service.

## Updating / redeploying

- **Code or config change:** `fly deploy` rebuilds the image from the Dockerfile and boots a fresh
  machine (config regenerated from the Dockerfile CMD, clearing any `sleep infinity` override). The
  volume and its data persist across deploys.
- **New Wikipedia graph:** build a fresh `wikinaut.sqlite` ([`data-source.md`](./data-source.md)),
  stage it (Step 2), load it onto the volume (Step 4, using the `sleep infinity` trick so you're not
  fighting the health check), then `fly deploy`. Because the app opens `sdow.sqlite`, do the atomic
  rename only after the new file has fully transferred. **Also rebuild and reload the CSR arrays
  from the same dump (Step 4b)** — or delete `/data/csr/` so the app falls back to SQLite instead
  of serving paths from the older graph.

To validate the production image locally before deploying, use the container smoke test in
[`CONTRIBUTING.md`](../.github/CONTRIBUTING.md).
