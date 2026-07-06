# Contributing | Wikinaut

Thanks for contributing to Wikinaut!

There are two pieces:

1. **Userscript** — `wikinaut.user.js`, the Tampermonkey frontend. This is the **main addition** of
   this fork (the space-themed navigation game) and where most new work happens.
2. **Backend** — the Python/Flask API (`sdow/`) plus the graph build scripts (`scripts/`), forked
   from [jwngr/sdow](https://github.com/jwngr/sdow) and updated for the 2024 Wikipedia schema change.

Related docs: [`data-source.md`](../docs/data-source.md) (build the full graph) and
[`web-server-setup.md`](../docs/web-server-setup.md) (deploy the backend to production).

Note: the following instructions have only been tested on macOS.

## Backend: local setup

Clone the repo and move into it:

```bash
git clone git@github.com:jackcareynapa/wikinaut.git
cd wikinaut/
```

You'll need a few tools (install via [Homebrew](https://brew.sh/) on macOS):

1. [`sqlite3`](https://www.sqlite.org/) — data storage
2. [`pyenv`](https://github.com/pyenv/pyenv) — manage Python versions (Python 3)
3. [`virtualenv`](https://virtualenv.pypa.io/) — isolate dependencies

```bash
brew install sqlite pyenv
pyenv install 3        # then configure pyenv per its docs
python -m pip install --user virtualenv
```

Install project dependencies and generate a mock database — a ~35-page graph, no Wikipedia dump
needed. `create_mock_databases.py` uses only the Python standard library (no `sqlite3` CLI required)
and is safe to re-run:

```bash
# From the repo root
virtualenv env
source env/bin/activate
pip install -r requirements.txt
python scripts/create_mock_databases.py   # writes sdow/sdow.sqlite + sdow/searches.sqlite
```

To build the **full** graph from a real Wikipedia dump (Linux-only, ~2 hours, hefty machine), see
[`data-source.md`](../docs/data-source.md).

### Run the backend

Every session, source your environment and start Flask. The mock `sdow.sqlite` / `searches.sqlite`
live in `sdow/`, so run from there. Two environment variables configure Flask:

- `FLASK_APP=server.py` — the app entry point.
- `FLASK_DEBUG=1` — auto-reload + debug errors (development only).

```bash
source env/bin/activate
cd sdow/
export FLASK_APP=server.py FLASK_DEBUG=1
flask run        # http://localhost:5000
```

The server itself needs no other environment variables.

Smoke-test it:

```bash
curl http://localhost:5000/ok
curl -X POST http://localhost:5000/paths \
  -H 'content-type: application/json' \
  -d '{"source":"1","target":"6"}'
```

`/ok` returns a JSON timestamp; `/paths` returns a `paths` array (a route through the mock graph).

## Userscript: local setup

1. Install [Tampermonkey](https://www.tampermonkey.net/).
2. Install `wikinaut.user.js`. During development, point it at your local backend via
   **⚙ Settings → Backend URL** → `http://localhost:5000` (you may need to approve the `@connect`
   prompt).
3. Open an English Wikipedia article and iterate.
4. Syntax-check before committing: `node --check wikinaut.user.js`.

The userscript keeps a clean split between the **engine** (`Routing`, `Titles`, `Storage`, `Links`,
`Traversal`) and the **cosmetic layer** (`Figure`/ship, `Trail`, `Transition`/hyperspace, CSS). The
highest-value, trickiest code is the DOM link-matching in `Links` — be careful there.

## Validation checklist

Before sending changes, run the relevant checks below:

```bash
# Userscript syntax
node --check wikinaut.user.js

# Backend automated tests — runs against the mock graph (tests/conftest.py regenerates it), no
# network access needed. Covers shortest-path correctness, malformed-request handling, and
# error-response shape.
source env/bin/activate
pip install -r requirements-dev.txt
pytest tests/ -v

# Python build scripts + backend compile cleanly
python3 -m py_compile scripts/*.py sdow/*.py

# Shell build script syntax
bash -n scripts/buildDatabase.sh

# Python style (dev tools — install separately; they are NOT in requirements.txt)
pip install pycodestyle autopep8
pycodestyle --config=setup.cfg sdow/ scripts/
autopep8 --diff --recursive sdow/ scripts/   # drop --diff and add --in-place to apply

# Backend smoke test (see "Run the backend" above): mock DB + /ok + /paths
```

Style is 2-space indentation, ~100-char lines, PEP 8 (config in [`setup.cfg`](../setup.cfg)). The
graph build scripts are Python 3.

## Common workflows

- **Change the userscript:** edit `wikinaut.user.js`, `node --check`, reload in Tampermonkey against a
  local `flask run`, and test on a real Wikipedia article.
- **Change the backend (Flask/BFS):** run `create_mock_databases.py`, `flask run`, and re-run the
  `/ok` + `/paths` smoke test; `py_compile` and `pycodestyle` before committing.
- **Change the graph build (`scripts/`):** the pipeline is documented in
  [`data-source.md`](../docs/data-source.md); a full run needs a real dump, but `bash -n` +
  `py_compile` catch syntax issues, and the mock generator exercises the SQLite/BFS side quickly.

## Local container smoke test

You can validate the production Docker image without the full graph by mounting the mock database:

```bash
python3 scripts/create_mock_databases.py            # writes sdow/sdow.sqlite + sdow/searches.sqlite
mkdir -p /tmp/wikinaut-data && cp sdow/*.sqlite /tmp/wikinaut-data/
docker build -t wikinaut-api .
docker run --rm -p 8085:8080 -v /tmp/wikinaut-data:/data wikinaut-api
# in another shell:
curl localhost:8085/ok
curl -X POST localhost:8085/paths -H 'content-type: application/json' -d '{"source":"1","target":"6"}'
```

## Repo organization

- `.github/` — contribution docs, issue/PR templates, Dependabot config
- `docs/` — documentation (`data-source.md` for the graph build, `web-server-setup.md` for the
  production deploy, `miscellaneous.md`)
- `scripts/` — graph build pipeline and helper scripts
- `sdow/` — the Python Flask web server
  - `server.py` — Flask entry point
  - `database.py` — SQLite query wrapper
  - `breadth_first_search.py` — the bidirectional BFS
  - `helpers.py` — Wikipedia API integration and error classes
- `sql/` — SQLite table schemas
- `tests/` — backend pytest suite (runs against the mock graph, no network access needed)
- `wikinaut.user.js` — the Tampermonkey userscript (frontend)
- `Dockerfile` / `fly.toml` — backend container + Fly.io deploy config
- `requirements.txt` — Python dependencies (`requirements-dev.txt` adds `pytest`)
- `setup.cfg` — Python lint/format config
