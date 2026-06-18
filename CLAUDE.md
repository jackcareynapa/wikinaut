# CLAUDE.md

Guidance for AI assistants (and humans) working in this repository.

## What this project is

**Wikinaut** — a space-themed navigation "game" for Wikipedia. The player opens a
panel on any Wikipedia article, specifies a destination article, and Wikinaut
charts the **shortest link-path** to it. If several equally-short paths exist, the
player chooses one. Then they hit **Launch** and "fly" from page to page, clicking
through the actual links on each live Wikipedia page until they reach the
destination.

## Architecture — this is TWO programs, not one

A browser userscript cannot do the pathfinding itself: the Wikipedia link graph is
several GB and breadth-first search runs over the whole thing. So the project is
split:

1. **Backend (`sdow/`, forked from jwngr/sdow)** — a Python/Flask API server that
   answers shortest-path queries over HTTP, reading the link graph from a SQLite
   file (disk-bound; see algorithm notes). This is reused almost as-is from upstream.
   It already returns *all* shortest paths for a query, which is what powers the
   "choose between multiple paths" feature — no extra work needed there. Deployed to
   Fly.io (see `docs/deployment.md`).

2. **Frontend (`wikinaut.user.js`, the Tampermonkey userscript)** — runs on
   `en.wikipedia.org` article pages. Injects the space-themed console panel, takes a
   destination, calls the backend for the path(s), lets the player pick, then drives
   navigation link-by-link. This is the new code unique to this project.

**Request flow:**
panel opens → player types destination → userscript issues
`POST https://<backend>/paths` with JSON body `{"source": <current>, "target": <dest>}`
→ backend returns path(s) as page-ID sequences plus a `pages` lookup → panel renders
them as a star map → player picks → Launch → the ship flies link-by-link, clicking
through the actual on-page links until it reaches the destination.

## Repo layout

The repo is **flat** (not nested under `sdow/` like upstream):

```
sdow/             Python package: server.py (Flask app), breadth_first_search.py (the algorithm),
                  database.py, helpers.py
scripts/          buildDatabase.sh + friends — download + process Wikipedia dumps into SQLite
sql/              SQLite table schemas
docs/             Documentation, including deployment.md (Fly.io) and data-source.md (build)
wikinaut.user.js  The Tampermonkey userscript (Wikinaut frontend)
Dockerfile        Backend container image (used by the Fly.io deploy)
fly.toml          Fly.io app config
```

> The upstream React `website/` and its Firebase hosting / CI have been **deleted** —
> Wikinaut's frontend is the userscript, not a website.

## The build pipeline: handling the `pagelinks` → `linktarget` schema change

Upstream sdow parsed the Wikipedia `pagelinks` table assuming the **old schema**, where
link target titles lived directly in `pagelinks` (`pl_namespace` / `pl_title`).

**Around July 1, 2024, Wikipedia normalized this.** `pl_namespace` and `pl_title` were
dropped; a link's target is now resolved by joining `pagelinks.pl_target_id` against a new
**`linktarget`** table to get the title, then resolving that title to a page ID.

**This repo handles it.** `scripts/buildDatabase.sh` now downloads the `linktarget` dump,
trims `pagelinks` (new schema) to `<source id>\t<target id>` and `linktarget` to
`<target id>\t<title>`, then `scripts/replace_link_targets_in_links_file.py` joins them to
recreate the legacy `<source id>\t<title>` links file the rest of the pipeline consumes.
All build scripts were also ported from Python 2 to Python 3. If you touch dump processing,
preserve this join.

## Algorithm notes (don't reinvent these)

- The Wikipedia link graph is **unweighted** — every link is one hop. For unweighted
  shortest paths, **BFS is asymptotically optimal.** Dijkstra adds nothing (no edge
  weights); A* has no usable heuristic for "links between articles." Do not propose
  these as speedups.
- The backend uses **bidirectional BFS** (search forward from source, backward from
  target, stop when frontiers meet). This is correct and should stay.
- Language (Python vs. Rust) is **not** the speed lever. Most article pairs are 3–5
  hops apart and bidirectional search keeps both frontiers tiny, so per-query CPU is
  modest. The bottleneck is neighbor-lookup speed, i.e. graph representation.
- Graph representation, slowest → fastest:
  - sdow default: adjacency as pipe-separated ID strings in SQLite (low memory, disk-bound).
  - Faster: in-memory **CSR** (compressed sparse row) — one flat `uint32` array of all
    neighbors + an offset array indexed by page ID; neighbor lookup is an array slice.
    Doable in pure Python with numpy memory-mapped arrays. ~5–8 GB RAM for English
    Wikipedia (~6M pages, ~150M links).
- **Optimization for a fixed target:** if the destination is usually the same, skip
  per-query bidirectional BFS. Run one BFS from the target over the *reversed* graph,
  store parent pointers, and every walk becomes O(path length) — basically instant.
  Use this only if the target is fixed; otherwise bidirectional BFS per query is right.

## The hard part of the frontend: matching graph path → live DOM

The backend returns a sequence of *articles* (IDs/titles). The walker must find, in
the **rendered DOM of the current live page**, the actual `<a>` element to the next
article. Three things to handle:

- **Redirects.** The graph resolves redirects to canonical titles, but the on-page
  link may use a redirect alias (`/wiki/NYC` vs. `New York City`). Match generously
  on `href`, and account for the redirects table when needed.
- **Link location.** The graph counts ALL namespace-0 links, including those in
  infoboxes, bottom navboxes, and collapsed sections — not just the article body. The
  "next" link may be buried. Scan the whole page:
  `a[href*="/wiki/<Target_Title>"]`, handling URL-encoding and underscore/space.
- **Snapshot vs. live staleness.** The graph is a dump from a fixed date; the player
  walks *current* Wikipedia. A link present in the dump may have been removed from the
  live page → dead end. Always provide a fallback: if the expected link isn't in the
  DOM, navigate directly by URL (or flag it and offer to recompute). Design for this
  from the start.

## Userscript conventions

- Call the backend with **`GM_xmlhttpRequest`**, not `fetch`. A plain `fetch` from a
  `wikipedia.org` page to your backend hits the CORS wall. `GM_xmlhttpRequest` plus the
  `// @connect` directives in the userscript header avoids it. The script defaults to the
  hosted Fly backend and reads a self-host override from GM storage (Settings → Backend URL).
- The "flying through space" animation is pure cosmetics (the `Figure`/ship, `Trail` canvas,
  `Transition` hyperspace overlay, CSS). It carries none of the hard logic — keep that layer
  separate from the engine (`Routing`, `Titles`, `Storage`, `Links`, `Traversal`). Internal
  identifiers in the script keep their original names (e.g. `Figure`, `House`, `walkTo`) even
  though the theme is now a spacecraft — they're invisible to the player.
- Userscript runs on `en.wikipedia.org`; keep the `@match` scoped to article pages.

## Working in this repo — guidance for assistants

- **Backend changes** live in `sdow/` (Flask + search) and `scripts/` (graph build).
  Reuse the upstream BFS; don't rewrite it. `server.py` is deployed unchanged — the
  Dockerfile launches gunicorn with `--chdir /data --pythonpath /app sdow.server:app` so
  the DB resolves on the Fly volume without code edits.
- **The graph build is the risky area.** Any task touching dump processing must preserve
  the `linktarget` join (above) and stay Python-3 compatible.
- **Frontend changes** are in `wikinaut.user.js`. The high-value, high-difficulty code is
  the DOM link-matching (`Links`) and navigation (`Traversal`/`Transition`), not the
  pathfinding.
- Stay in **Python** for backend work (project owner's primary language); don't
  propose a Rust rewrite as a "speedup" — see algorithm notes for why it isn't one.

## Common commands

```bash
# Backend: set up environment (from repo root)
virtualenv env && source env/bin/activate && pip install -r requirements.txt

# Create a small mock graph for local dev (no full dump needed)
python scripts/create_mock_databases.py

# Run the API server locally (from sdow/, which holds the mock sdow.sqlite/searches.sqlite)
cd sdow/ && export FLASK_APP=server.py FLASK_DEBUG=1 && flask run

# Build the full graph from a Wikipedia dump (hours; does the linktarget join)
cd scripts/ && ./buildDatabase.sh <YYYYMMDD>

# Build + run the backend container locally against the mock DB
docker build -t wikinaut-api . && \
  mkdir -p /tmp/wn && cp sdow/*.sqlite /tmp/wn/ && \
  docker run --rm -p 8085:8080 -v /tmp/wn:/data wikinaut-api   # then curl localhost:8085/ok

# Lint the userscript
node --check wikinaut.user.js
```

See `docs/deployment.md` for the full Fly.io deploy (GCE graph build → volume → `fly deploy`).

## Upstream reference

- Forked from: `jwngr/sdow` (Six Degrees of Wikipedia)
- Related implementation that already handles the `linktarget` schema (Rust, useful as
  a reference for the join logic): `hut8/wikiwalk`
