# WARP.md

This file provides guidance to WARP (warp.dev) when working with code in this repository.

## Project Overview

**Wikinaut** is a space-themed Wikipedia navigation game. It finds the shortest link-path between
two Wikipedia articles and then "flies" the player through it, clicking the real links on each live
page. It has two parts:

- **Backend**: Python Flask API (`sdow/`), forked from [jwngr/sdow](https://github.com/jwngr/sdow),
  serving shortest-path queries from a SQLite link graph. Deployed to Fly.io (`Dockerfile`,
  `fly.toml`, `docs/deployment.md`).
- **Frontend**: a Tampermonkey **userscript** (`wikinaut.user.js`) that runs on Wikipedia — there is
  no website.
- **Database**: scripts (`scripts/`) that download, process, and build the Wikipedia dump into
  `sdow.sqlite`.

> The upstream React `website/` and its Firebase hosting/CI have been removed. Ignore references to
> a frontend website.

## Development Environment Setup

```bash
# From repo root — create the Python virtualenv and install deps
virtualenv env
source env/bin/activate
pip install -r requirements.txt

# Create a tiny mock database for development (no Wikipedia dump needed)
python scripts/create_mock_databases.py
```

### Run the backend

The mock `sdow.sqlite` / `searches.sqlite` live in `sdow/`, so run Flask from there:

```bash
source env/bin/activate
cd sdow/
export FLASK_APP=server.py FLASK_DEBUG=1
flask run        # http://localhost:5000
```

### Frontend (userscript)

Install `wikinaut.user.js` in Tampermonkey. During development point it at your local backend via
the console's **⚙ Settings → Backend URL** (`http://localhost:5000`). Syntax-check with
`node --check wikinaut.user.js`.

## Core Development Commands

```bash
# Run server in debug mode
cd sdow/ && export FLASK_APP=server.py FLASK_DEBUG=1 && flask run

# Lint / format Python (2-space indent, ~100-char lines, PEP 8)
pylint sdow/
autopep8 --in-place --recursive sdow/

# Query the database directly
litecli sdow/sdow.sqlite

# Create mock databases
python scripts/create_mock_databases.py

# Build the full graph from Wikipedia dumps (hours; high-memory machine)
cd scripts/ && ./buildDatabase.sh            # or ./buildDatabase.sh <YYYYMMDD>

# Build + run the backend container locally against the mock DB
docker build -t wikinaut-api .
mkdir -p /tmp/wn && cp sdow/*.sqlite /tmp/wn/
docker run --rm -p 8085:8080 -v /tmp/wn:/data wikinaut-api
```

## Architecture Overview

### Bidirectional Breadth-First Search

The core search (`sdow/breadth_first_search.py`) uses bidirectional BFS — searching from source and
target simultaneously, choosing direction by link count, and reconstructing paths via parent
tracking when the frontiers meet. The graph is unweighted, so BFS is optimal; Dijkstra/A\* add
nothing. It returns *all* shortest paths.

### Database Schema (`sdow.sqlite`)

- **pages**: `id`, `title`, `is_redirect`
- **links**: `id`, `outgoing_links_count`, `incoming_links_count`, `outgoing_links`,
  `incoming_links` (pipe-separated page-ID strings)
- **redirects**: `source_id`, `target_id`
- **searches** (`searches.sqlite`): query log with timing data

### API Endpoints

- `POST /paths` — body `{"source": "Page A", "target": "Page B"}`; returns `paths` (page-ID arrays)
  and a `pages` lookup.
- `GET /ok` — health check.

### Data Flow

1. Userscript sends `POST /paths` with source/target titles.
2. Backend resolves titles to page IDs (handling redirects).
3. Bidirectional BFS finds the shortest paths.
4. Wikipedia API supplies page metadata (titles, URLs, summaries).
5. Results returned as JSON; the userscript renders the path as a star map and flies it.

### Database Build Pipeline

`scripts/buildDatabase.sh` downloads the `page`, `redirect`, `pagelinks`, and `linktarget` dumps,
then trims/transforms/sorts/imports them into `sdow.sqlite`.

**Important — the 2024 schema change:** `pagelinks` no longer stores titles; it references a new
`linktarget` table by `pl_target_id`. The pipeline trims `pagelinks` →
`<source id>\t<target id>` and `linktarget` → `<target id>\t<title>`, then
`scripts/replace_link_targets_in_links_file.py` joins them back to the legacy `<source id>\t<title>`
format. All build scripts are Python 3. Preserve this join when touching dump processing.

### Production Architecture

- **Container**: `Dockerfile` (python:3.12-slim, gunicorn) — launched with
  `--chdir /data --pythonpath /app sdow.server:app` so the SQLite DB resolves on the mounted volume
  without code changes.
- **Host**: Fly.io always-on machine + a persistent volume at `/data` holding `sdow.sqlite`
  (`fly.toml`). See `docs/deployment.md`.

## Mock vs Production Data

- **Development**: `create_mock_databases.py` builds a ~35-page mock graph for testing the search
  and the API.
- **Production**: `buildDatabase.sh` processes full Wikipedia dumps (~6M+ pages, ~150M+ links;
  significant time and disk).
