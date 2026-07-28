# Contributing | Wikinaut

There are two pieces:

1. **Userscript** (`wikinaut.user.js`): the Tampermonkey frontend, and where most new work happens.
2. **Backend**: the Python/Flask API (`sdow/`) plus the graph build scripts (`scripts/`), forked
   from [jwngr/sdow](https://github.com/jwngr/sdow) and updated for the 2024 Wikipedia schema
   change.

Related docs: [`data-source.md`](../docs/data-source.md) to build the full graph, and
[`web-server-setup.md`](../docs/web-server-setup.md) to deploy the backend.

The instructions below have only been tested on macOS.

## Backend: local setup

Clone the repo and move into it:

```bash
git clone git@github.com:jackcareynapa/wikinaut.git
cd wikinaut/
```

You need a few tools (install via [Homebrew](https://brew.sh/) on macOS):

1. [`sqlite3`](https://www.sqlite.org/) for data storage
2. [`pyenv`](https://github.com/pyenv/pyenv) to manage Python versions (Python 3)
3. [`virtualenv`](https://virtualenv.pypa.io/) to isolate dependencies

```bash
brew install sqlite pyenv
pyenv install 3        # then configure pyenv per its docs
python -m pip install --user virtualenv
```

Install dependencies and generate a mock database, a ~35-page graph needing no Wikipedia dump.
`create_mock_databases.py` uses only the Python standard library (no `sqlite3` CLI required) and is
safe to re-run:

```bash
# From the repo root
virtualenv env
source env/bin/activate
pip install -r requirements.txt
python scripts/create_mock_databases.py
```

That writes three things into `sdow/`: `sdow.sqlite`, `searches.sqlite`, and the `csr/` link
arrays. The CSR arrays matter: `server.py` prefers them over the SQLite links table, so having them
locally means development exercises the same search path as production. Delete `sdow/csr/` to test
the SQLite fallback instead.

To build the **full** graph from a real Wikipedia dump (Linux-only, ~2 hours, hefty machine), see
[`data-source.md`](../docs/data-source.md).

### Run the backend

Every session, source your environment and start Flask. The mock `sdow.sqlite`, `searches.sqlite`,
and `csr/` live in `sdow/`, so run from there. Two environment variables configure Flask:

- `FLASK_APP=server.py` sets the app entry point.
- `FLASK_DEBUG=1` enables auto-reload and debug errors (development only).

```bash
source env/bin/activate
cd sdow/
export FLASK_APP=server.py FLASK_DEBUG=1
flask run        # http://localhost:5000
```

The server needs no other environment variables. On startup it logs whether it is serving links
from the CSR arrays or falling back to SQLite.

Smoke-test it:

```bash
curl http://localhost:5000/ok
curl -X POST http://localhost:5000/paths \
  -H 'content-type: application/json' \
  -d '{"source":"1","target":"6"}'
```

`/ok` returns a JSON timestamp; `/paths` returns a `paths` array plus a `pages` lookup.

### The /paths contract

`POST /paths` takes `{"source": <title>, "target": <title>}` and returns `paths` (a list of page-ID
lists), `pages` (page ID to title and URL), and the resolved `sourcePageTitle` / `targetPageTitle`
plus `isSourceRedirected` / `isTargetRedirected` flags.

Errors carry an HTTP status and a stable `code` field:

| Status | `code` | Cause |
|---|---|---|
| 400 | `no-content-type` | Body missing or not valid JSON |
| 400 | `bad-request` | A title is missing, not a string, empty, or over 256 characters |
| 400 | `page-not-found` | A title does not match any page |
| 404 | `not-found` | No such route |
| 405 | `method-not-allowed` | Wrong method for an existing route |
| 413 | `request-too-large` | Body over 8 KB |
| 429 | `rate-limited` | Per-client rate limit exceeded |
| 500 | `internal` | Unexpected server error (details are logged, not returned) |

The rate limit is per client IP and applies only to `/paths`, so `/ok` stays free for the Fly health
check. Behind Fly the client IP comes from the `Fly-Client-IP` header, falling back to
`X-Forwarded-For`.

## Userscript: local setup

1. Install [Tampermonkey](https://www.tampermonkey.net/).
2. Install `wikinaut.user.js`. During development, point it at your local backend via
   **⚙ Settings → Backend URL** with `http://localhost:5000` (you may need to approve the
   `@connect` prompt).
3. Open an English Wikipedia article and iterate.
4. Syntax-check before committing: `node --check wikinaut.user.js`.

The userscript keeps a clean split between the **engine** (`Routing`, `Titles`, `Storage`, `Links`,
`Traversal`) and the **cosmetic layer** (`Figure`/ship, `Trail`, `Transition`/hyperspace, CSS). FX
modules must never call `Phase.set`, `setStatus`, `Storage.save`/`clear`, or `link.click()`. The
trickiest code is the DOM link-matching in `Links`; be careful there.

`node --check` catches only syntax. Real verification means driving the script against live
Wikipedia in a browser, or with a throwaway Playwright harness that shims the `GM_*` APIs and mocks
the backend.

## Validation checklist

```bash
# Userscript syntax
node --check wikinaut.user.js

# Backend tests: run against the mock graph (conftest.py regenerates it), no network needed.
# Cover shortest-path correctness, CSR/SQLite parity, malformed-request handling, abuse limits,
# and search-log retention.
source env/bin/activate
pip install -r requirements-dev.txt
pytest tests/ -v

# Python build scripts and backend compile cleanly
python3 -m py_compile scripts/*.py sdow/*.py

# Shell build script syntax
bash -n scripts/buildDatabase.sh

# Python style (dev tools, installed separately; they are NOT in requirements.txt)
pip install pycodestyle autopep8
pycodestyle --config=setup.cfg sdow/ scripts/
autopep8 --diff --recursive sdow/ scripts/   # drop --diff and add --in-place to apply
```

Style is 2-space indentation, ~100-character lines, PEP 8 (config in [`setup.cfg`](../setup.cfg)).
The graph build scripts are Python 3.

## Local container smoke test

Validate the production Docker image without the full graph by mounting the mock database. Copy the
CSR arrays too, otherwise the container silently serves links from SQLite and the smoke test does
not exercise the production path:

```bash
python3 scripts/create_mock_databases.py
mkdir -p /tmp/wikinaut-data/csr
cp sdow/*.sqlite /tmp/wikinaut-data/
cp sdow/csr/*.npy /tmp/wikinaut-data/csr/
docker build -t wikinaut-api .
docker run --rm -p 8085:8080 -v /tmp/wikinaut-data:/data wikinaut-api
# in another shell:
curl localhost:8085/ok
curl -X POST localhost:8085/paths -H 'content-type: application/json' -d '{"source":"1","target":"6"}'
```

## Repo organization

- `.github/`: this file and the Dependabot config
- `docs/`: `data-source.md` for the graph build, `web-server-setup.md` for the production deploy
- `scripts/`: graph build pipeline and helper scripts
- `sdow/`: the Python Flask web server
  - `server.py`: Flask entry point, request validation, and abuse limits
  - `database.py`: SQLite query wrapper, paths cache, search-log retention
  - `csr_graph.py`: memory-mapped CSR link arrays (the preferred link source)
  - `breadth_first_search.py`: the bidirectional BFS
  - `helpers.py`: title sanitization, validation, and error classes
- `sql/`: SQLite table schemas
- `tests/`: backend pytest suite (runs against the mock graph, no network needed)
- `wikinaut.user.js`: the Tampermonkey userscript (frontend)
- `Dockerfile` / `fly.toml`: backend container and Fly.io deploy config
- `requirements.txt`: Python dependencies (`requirements-dev.txt` adds `pytest`)
- `setup.cfg`: Python lint/format config
