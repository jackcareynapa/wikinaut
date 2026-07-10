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
   Fly.io (see `docs/web-server-setup.md`).

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
                  database.py, csr_graph.py (memory-mapped link arrays), helpers.py
scripts/          buildDatabase.sh + friends — download + process Wikipedia dumps into SQLite;
                  build_csr_graph.py (SQLite links → CSR arrays), benchmark_paths.py
sql/              SQLite table schemas
docs/             Documentation, including web-server-setup.md (Fly.io) and data-source.md (build)
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
- Graph representation, slowest → fastest (**both are implemented; CSR is preferred**):
  - sdow default: adjacency as pipe-separated ID strings in SQLite (low memory, disk-bound).
    This is the fallback when the CSR arrays are absent.
  - **CSR** (compressed sparse row) — flat `uint32` neighbor arrays + `int64` offset arrays,
    built by `scripts/build_csr_graph.py` and served by `sdow/csr_graph.py` via numpy
    `mmap_mode='r'` (page-cache-shared across workers, ~1.3 GB on disk for English Wikipedia,
    near-zero RSS). `server.py` wires it in as `Database(..., link_source=CSRGraph.load('./csr'))`;
    SQLite still serves pages/redirects/title resolution. `scripts/create_mock_databases.py`
    builds mock CSR arrays too, so local dev and tests run the same path as production.
    Deploying the arrays to Fly is Step 4b in `docs/web-server-setup.md`; rebuild them whenever
    the graph dump is replaced (they're derived data).
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
- **Two renderers, two href forms.** Wikipedia serves articles from the legacy parser
  (relative hrefs: `/wiki/Foo`) AND from Parsoid read views (protocol-relative absolute
  hrefs: `//en.wikipedia.org/wiki/Foo`), rolled out per-article. Matching only the legacy
  form finds ZERO links on a Parsoid page — every hop there falsely reports "link not on
  page". Never prefix-match hrefs directly: normalize through `Titles.rawFromHref` (URL
  parse + same-hostname + `/wiki/` pathname check, which also rejects Commons/Wiktionary
  links that contain "/wiki/") and select with `SELECTORS.articleLink`.
- **Phantom rects in collapsed navboxes.** MediaWiki collapses navbox rows with
  `hidden="until-found"` (`content-visibility: hidden`) — links inside keep a NONZERO
  bounding rect while being unpainted, so display/visibility/0×0-rect checks all pass and the
  ship lands in empty space. Only `element.checkVisibility({contentVisibilityAuto: true, …})`
  sees through it — visibility tests must go through `Links.isRendered`/`isOnPage`.
  Also a race: navboxes are made collapsible seconds AFTER page load, so a link located while
  visible can be re-hidden mid-flight — guard at flight start and touchdown
  (`Links.ensureVisible`).
- **Snapshot vs. live staleness.** The graph is a dump from a fixed date; the player
  walks *current* Wikipedia. A link present in the dump may have been removed from the
  live page → dead end. Always provide a fallback: if the expected link isn't in the
  DOM, navigate directly by URL (or flag it and offer to recompute). Design for this
  from the start.

## Userscript conventions

- Call the backend with **`GM_xmlhttpRequest`**, not `fetch`. A plain `fetch` from a
  `wikipedia.org` page to your backend hits the CORS wall. `GM_xmlhttpRequest` plus the
  `// @connect` directives in the userscript header avoids it. The script defaults to the
  hosted Fly backend with a self-host override in Settings → Backend URL.
- **All player settings persist via GM storage** (`GM_getValue`/`GM_setValue`): the Backend
  URL override, plus flight speed and ship/trail colors (`wikinautSettings:v1` JSON blob).
  `sessionStorage` is only the no-GM fallback and a one-time migration source — don't move
  settings back there. In-flight route state (`wikinautState:v1`) intentionally stays in
  `sessionStorage`: it must survive same-tab navigation but not outlive the tab.
- The "flying through space" animation is pure cosmetics (the `Figure`/ship, `Trail` canvas,
  `Transition` hyperspace overlay, CSS). It carries none of the hard logic — keep that layer
  separate from the engine (`Routing`, `Titles`, `Storage`, `Links`, `Traversal`). Internal
  identifiers in the script keep their original names (e.g. `Figure`, `House`, `walkTo`) even
  though the theme is now a spacecraft — they're invisible to the player.
- **The cruise is document-space.** `Traversal.cruiseToLink` plans one cubic Bézier per hop in
  document coordinates; the page scroll is the camera (time-based lock plus a hard frame guard
  so the ship can never leave the viewport). The flight-speed setting is always honored —
  `CONFIG.maxCruiseDurationMs` is a safety net for pathological hops, **not a pacing knob**;
  lowering it silently overrides the player's speed slider on long flights.
- **CSS custom properties don't reach body-mounted layers.** During a journey `JourneyPortal`
  moves `#wikinaut-ship-shell` and `#wikinaut-jump-layer` onto `document.body` — outside
  `#wikinaut-root`. A `var()` consumed there with no declaration on the layer itself is
  invalid at computed-value time, which turns an SVG `fill` **black** (this was the
  "gray flame" bug) and silently activates every `var(…, fallback)`. Declare the `--wn-*`
  palette on all three hosts (`#wikinaut-root, #wikinaut-ship-shell, #wikinaut-jump-layer`)
  and set dynamic values on each host too (`Settings.applyToDom` does).
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
- **Verifying frontend changes:** there is no checked-in test suite for the userscript —
  `node --check` only catches syntax. Real verification means driving the actual script with
  a throwaway Playwright harness against live `en.wikipedia.org`: shim `GM_*` (mock the
  `/paths` backend) via `addInitScript`, inject the script body with `page.evaluate` (bypasses
  Wikipedia's CSP, unlike `addScriptTag`), then assert on real flights — landings, statuses,
  storage, screenshots. Several bugs (Parsoid hrefs, phantom navbox rects, the black flame)
  were only findable this way; don't sign off frontend work on static reading alone.
- Keep the **FX/engine boundary** mechanically clean: `Figure`/`Trail`/`Transition`/
  `LaunchSequence`/`LinkFx` must never call `Phase.set`, `setStatus`, `Storage.save/clear`,
  or `link.click()` — grep for these in FX modules before finishing any frontend change.
- Stay in **Python** for backend work (project owner's primary language); don't
  propose a Rust rewrite as a "speedup" — see algorithm notes for why it isn't one.

## Common commands

```bash
# Backend: set up environment (from repo root)
virtualenv env && source env/bin/activate && pip install -r requirements.txt

# Create a small mock graph for local dev (no full dump needed; also builds sdow/csr/ arrays)
python scripts/create_mock_databases.py

# Run the API server locally (from sdow/, which holds the mock sdow.sqlite/searches.sqlite)
cd sdow/ && export FLASK_APP=server.py FLASK_DEBUG=1 && flask run

# Build the full graph from a Wikipedia dump (hours; does the linktarget join)
cd scripts/ && ./buildDatabase.sh <YYYYMMDD>

# Build the CSR link arrays from a built graph (tens of minutes for the full dump)
python scripts/build_csr_graph.py <sdow.sqlite> <out_dir>

# Benchmark SQLite-vs-CSR search latency on a synthetic graph
python scripts/benchmark_paths.py

# Build + run the backend container locally against the mock DB (+ CSR arrays)
docker build -t wikinaut-api . && \
  mkdir -p /tmp/wn/csr && cp sdow/*.sqlite /tmp/wn/ && cp sdow/csr/*.npy /tmp/wn/csr/ && \
  docker run --rm -p 8085:8080 -v /tmp/wn:/data wikinaut-api   # then curl localhost:8085/ok

# Lint the userscript
node --check wikinaut.user.js
```

See `docs/web-server-setup.md` for the full Fly.io deploy (GCE graph build → volume → `fly deploy`).

## Operating the deployed Fly backend (hard-won gotchas)

These bit us once; don't relearn them. (Full runbook: `docs/web-server-setup.md` Step 4.)

- **`server.py` opens BOTH `./sdow.sqlite` and `./searches.sqlite` at import time** (with gunicorn's
  `--chdir /data`, those are `/data/sdow.sqlite` + `/data/searches.sqlite`). If *either* is missing on
  the volume, every worker raises `IOError` and the machine crash-loops to `stopped`. Both files must
  exist before the app can serve.
- **A crash-looping machine is unreachable** — `fly ssh console` needs a *started* VM, but the app
  exits ~7s after each boot when the DB is missing. To work on the volume (e.g. load the DB), first
  keep the machine alive by overriding its command:
  `fly machine update <id> -C "sleep infinity" --yes && fly machine start <id>`. When done, restore
  the real command with `fly deploy` (regenerates machine config from the Dockerfile CMD).
- **The image is `python:3.12-slim`: no `wget`, `curl`, or `sqlite3` CLI.** Use `python3` for both the
  download (`urllib`) and for seeding searches.sqlite (the `sqlite3` *module* +
  `executescript(open('/app/sql/createSearchesTable.sql').read())`).
- **Loading the ~14 GB graph onto the volume:** stream it from GCS with your *locally*-authenticated
  `gsutil` piped over `fly ssh`
  (`gsutil cp gs://wikinaut-dumps/wikinaut.sqlite - | fly ssh console -C 'cat > /data/sdow.sqlite.part'`).
  **Never copy a GCP access token onto the Fly host** (credential leakage; it's also blocked). A single
  14 GB SSH stream is fragile and *will* drop, so make it **resumable**: read the current `.part` size
  and append only the rest with `gsutil cat -r <offset>- … | fly ssh … 'cat >> …part'`. Guard the size
  probe — if it returns empty (ssh hiccup), skip the round; defaulting to 0 re-appends from the start
  and corrupts the file. `mv …part sdow.sqlite` only after the byte count matches the source exactly.
- **Object/file name mismatch:** the bucket object is `wikinaut.sqlite`, but the app opens
  `sdow.sqlite` — rename it on the way onto the volume.
- **The Fly volume's region MUST match `fly.toml`'s `primary_region`** (`sjc`), or a booting machine
  gets a fresh, empty volume instead of your data.

## Upstream reference

- Forked from: `jwngr/sdow` (Six Degrees of Wikipedia)
- Related implementation that already handles the `linktarget` schema (Rust, useful as
  a reference for the join logic): `hut8/wikiwalk`
