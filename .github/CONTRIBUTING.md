# Contributing | Wikinaut

Thanks for contributing to Wikinaut!

There are two pieces:

1. **Backend** — the Python/Flask API (`sdow/`) plus the graph build scripts (`scripts/`).
2. **Userscript** — `wikinaut.user.js`, the Tampermonkey frontend.

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

Install project dependencies and generate a mock database (a ~35-page graph — no Wikipedia dump
needed):

```bash
# From the repo root
virtualenv env
source env/bin/activate
pip install -r requirements.txt
python scripts/create_mock_databases.py
```

### Run the backend

Every session, source your environment and start Flask. The mock `sdow.sqlite` /
`searches.sqlite` live in `sdow/`, so run from there:

```bash
source env/bin/activate
cd sdow/
export FLASK_APP=server.py FLASK_DEBUG=1
flask run        # http://localhost:5000
```

Smoke-test it:

```bash
curl http://localhost:5000/ok
curl -X POST http://localhost:5000/paths \
  -H 'content-type: application/json' \
  -d '{"source":"1","target":"6"}'
```

### Python style

2-space indentation, ~100-char lines, PEP 8 (see `.pylintrc` / `setup.cfg`). The graph build
scripts are Python 3. Run `pylint sdow/` / `autopep8 --in-place --recursive sdow/` before sending
changes.

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

## Repo organization

- `.github/` — contribution docs, issue/PR templates, Dependabot config
- `config/` — legacy VM configs (nginx, gunicorn, supervisord)
- `docs/` — documentation (including `deployment.md` and `data-source.md`)
- `scripts/` — graph build pipeline and helper scripts
- `sdow/` — the Python Flask web server
  - `server.py` — Flask entry point
  - `database.py` — SQLite query wrapper
  - `breadth_first_search.py` — the bidirectional BFS
  - `helpers.py` — Wikipedia API integration and error classes
- `sql/` — SQLite table schemas
- `wikinaut.user.js` — the Tampermonkey userscript (frontend)
- `Dockerfile` / `fly.toml` — backend container + Fly.io deploy config
- `requirements.txt` — Python dependencies
- `.pylintrc` / `setup.cfg` — Python lint/format config
