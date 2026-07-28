# CLAUDE.md

Guidance for AI assistants (and humans) working in this repository.

## What this project is

**Wikinaut** is a space-themed navigation "game" for Wikipedia. The player opens a
panel on any Wikipedia article, specifies a destination article, and Wikinaut
charts the **shortest link-path** to it. If several equally-short paths exist, the
player chooses one. Then they hit **Launch** and "fly" from page to page, clicking
through the actual links on each live Wikipedia page until they reach the
destination.

## Architecture: this is TWO programs, not one

A browser userscript cannot do the pathfinding itself: the Wikipedia link graph is
several GB and breadth-first search runs over the whole thing. So the project is
split:

1. **Backend (`sdow/`, forked from jwngr/sdow)**: a Python/Flask API server that
   answers shortest-path queries over HTTP. Originally a thin fork, it has since
   diverged: memory-mapped CSR link arrays, SQLite pragmas, an LRU paths cache,
   request-abuse limits, and search-log retention are all Wikinaut's. It returns
   *all* shortest paths for a query, which is what powers route selection.
   Deployed to Fly.io (see `docs/web-server-setup.md`).

2. **Frontend (`wikinaut.user.js`, the Tampermonkey userscript)**: runs on
   `en.wikipedia.org` article pages. Injects the console panel, takes a
   destination, calls the backend for the path(s), lets the player pick, then drives
   navigation link-by-link. This is the new code unique to this project.

**Request flow:**
panel opens, player types destination, userscript issues
`POST https://<backend>/paths` with JSON body `{"source": <current>, "target": <dest>}`,
backend returns path(s) as page-ID sequences plus a `pages` lookup, panel renders
them as a star map, player picks, Launch, then the ship flies link-by-link, clicking
through the actual on-page links until it reaches the destination.

## Repo layout

```
sdow/             Python package: server.py (Flask app, validation, abuse limits),
                  breadth_first_search.py (the algorithm), database.py,
                  csr_graph.py (memory-mapped link arrays), helpers.py
scripts/          buildDatabase.sh and friends: download and process Wikipedia dumps into
                  SQLite; build_csr_graph.py (SQLite links to CSR arrays), benchmark_paths.py
sql/              SQLite table schemas
tests/            Backend pytest suite; runs against the mock graph, no network needed
docs/             web-server-setup.md (Fly.io deploy) and data-source.md (graph build)
.github/          CONTRIBUTING.md and the Dependabot config
wikinaut.user.js  The Tampermonkey userscript (Wikinaut frontend)
Dockerfile        Backend container image (used by the Fly.io deploy)
fly.toml          Fly.io app config
requirements.txt  Runtime deps (requirements-dev.txt adds pytest); setup.cfg is lint config
```

## The build pipeline: the `pagelinks` to `linktarget` schema change

Upstream sdow parsed the Wikipedia `pagelinks` table assuming the **old schema**, where
link target titles lived directly in `pagelinks` (`pl_namespace` / `pl_title`).

**Around July 1, 2024, Wikipedia normalized this.** `pl_namespace` and `pl_title` were
dropped; a link's target is now resolved by joining `pagelinks.pl_target_id` against a new
**`linktarget`** table to get the title, then resolving that title to a page ID.

**This repo handles it.** `scripts/buildDatabase.sh` downloads the `linktarget` dump,
trims `pagelinks` (new schema) to `<source id>\t<target id>` and `linktarget` to
`<target id>\t<title>`, then `scripts/replace_link_targets_in_links_file.py` joins them to
recreate the legacy `<source id>\t<title>` links file the rest of the pipeline consumes.
All build scripts are Python 3. If you touch dump processing, preserve this join.
Full detail lives in `docs/data-source.md`.

## Algorithm notes (don't reinvent these)

- The link graph is **unweighted**, so BFS is asymptotically optimal. Dijkstra adds
  nothing without edge weights, and A* has no usable heuristic here. Do not propose
  either as a speedup.
- The backend uses **bidirectional BFS**. This is correct; keep it.
- The bottleneck is **neighbor-lookup speed**, not language. Per-query CPU is modest
  because most pairs are 3-5 hops apart and both frontiers stay small. Do not propose a
  Rust rewrite as a speedup; backend work stays in Python.
- Two graph representations exist, and **CSR is preferred**:
  - **CSR** (compressed sparse row): flat `uint32` neighbor arrays plus `int64` offset
    arrays, built by `scripts/build_csr_graph.py` and served by `sdow/csr_graph.py` via
    numpy `mmap_mode='r'`. Page-cache-shared across workers, ~1.3 GB on disk for English
    Wikipedia, near-zero RSS. `server.py` wires it in as
    `Database(..., link_source=CSRGraph.load('./csr'))`.
  - **SQLite fallback**: adjacency as pipe-separated ID strings. Used automatically when
    the CSR arrays are absent.
  SQLite still serves pages, redirects, and title resolution either way.
  `scripts/create_mock_databases.py` builds mock CSR arrays, so local dev and tests run the
  production path. Rebuild the arrays whenever the graph is replaced; they are derived data.

## The hard part of the frontend: matching graph path to live DOM

The backend returns a sequence of *articles* (IDs/titles). The walker must find, in
the **rendered DOM of the current live page**, the actual `<a>` element to the next
article. Five things to handle:

- **Redirects.** The graph resolves redirects to canonical titles, but the on-page
  link may use a redirect alias (`/wiki/NYC` vs. `New York City`). Match generously
  on `href`, and account for the redirects table when needed.
- **Link location.** The graph counts ALL namespace-0 links, including those in
  infoboxes, bottom navboxes, and collapsed sections, not just the article body. The
  "next" link may be buried, so scan the whole page, handling URL-encoding and
  underscore/space.
- **Two renderers, two href forms.** Wikipedia serves articles from the legacy parser
  (relative hrefs: `/wiki/Foo`) AND from Parsoid read views (protocol-relative absolute
  hrefs: `//en.wikipedia.org/wiki/Foo`), rolled out per-article. Matching only the legacy
  form finds ZERO links on a Parsoid page. Never prefix-match hrefs directly: normalize
  through `Titles.rawFromHref` (URL parse, same-hostname, and `/wiki/` pathname check,
  which also rejects Commons/Wiktionary links containing "/wiki/") and select with
  `SELECTORS.articleLink`.
- **Phantom rects in collapsed navboxes.** MediaWiki collapses navbox rows with
  `hidden="until-found"` (`content-visibility: hidden`). Links inside keep a NONZERO
  bounding rect while unpainted, so display/visibility/zero-rect checks all pass and the
  ship lands in empty space. Only `element.checkVisibility({contentVisibilityAuto: true, …})`
  sees through it, so visibility tests must go through `Links.isRendered`/`isOnPage`.
  Navboxes are also made collapsible seconds AFTER page load, so a link located while
  visible can be re-hidden mid-flight; guard at flight start and touchdown
  (`Links.ensureVisible`).
- **Snapshot vs. live staleness.** The graph is a dump from a fixed date; the player
  walks *current* Wikipedia, so a link present in the dump may be gone from the live page.
  Always provide a fallback: if the expected link isn't in the DOM, navigate directly by
  URL. `Titles.toUrlTitle` percent-encodes for this path, which matters because real titles
  contain `?` and `#`.

## Userscript conventions

- Call the backend with **`GM_xmlhttpRequest`**, not `fetch`. A plain `fetch` from a
  `wikipedia.org` page to your backend hits the CORS wall. `GM_xmlhttpRequest` plus the
  `// @connect` directives in the userscript header avoids it. The script defaults to the
  hosted Fly backend with a self-host override in Settings, Backend URL.
- **All player settings persist via GM storage** (`GM_getValue`/`GM_setValue`): the Backend
  URL override, plus flight speed and the single ship/console color (`wikinautSettings:v1`
  JSON blob). That one color drives everything via `deriveColorway`/`Settings.colorway()`:
  ship, flame, trail ramp, hyperspace streaks, the console accent family, and the console's
  body text. Don't add a second color setting.
  `sessionStorage` is only the no-GM fallback and a one-time migration source; don't move
  settings back there. In-flight route state (`wikinautState:v1`) intentionally stays in
  `sessionStorage`: it must survive same-tab navigation but not outlive the tab.
- **One color, many derived tokens.** `deriveColorway` emits the accent family (`base`,
  `hot`, `glow`, `deep`), the streak pair, the trail ramp ends, and the text tokens
  (`parchment`, `dimWhite`, `ink`). `Settings.applyToDom` must set each as a `--wn-*` custom
  property AND its `-rgb` triplet, because many rules read `rgba(var(--wn-x-rgb), α)`.
  Deliberately NOT derived: `--wn-signal` (reserved fault red), `--wn-blue`/`--wn-blue-glow`
  (graticule and next-waypoint distinction), `--wn-purple` (contrast lane).
- The "flying through space" animation is pure cosmetics (the `Figure`/ship, `Trail` canvas,
  `Transition` hyperspace overlay, CSS). It carries none of the hard logic, so keep that
  layer separate from the engine (`Routing`, `Titles`, `Storage`, `Links`, `Traversal`).
  Some internal identifiers keep pre-theme names (e.g. `Figure`, `walkTo`); they're
  invisible to the player.
- **The cruise is document-space.** `Traversal.cruiseToLink` plans one cubic Bézier per hop in
  document coordinates; the page scroll is the camera (time-based lock plus a hard frame guard
  so the ship can never leave the viewport). The flight-speed setting is always honored.
  `CONFIG.maxCruiseDurationMs` is a safety net for pathological hops, **not a pacing knob**;
  lowering it silently overrides the player's speed slider on long flights.
- **CSS custom properties don't reach body-mounted layers.** During a journey `JourneyPortal`
  moves `#wikinaut-ship-shell` and `#wikinaut-jump-layer` onto `document.body`, outside
  `#wikinaut-root`. A `var()` consumed there with no declaration on the layer itself is
  invalid at computed-value time, which turns an SVG `fill` **black** and silently activates
  every `var(…, fallback)`. Declare the `--wn-*` palette on all three hosts
  (`#wikinaut-root, #wikinaut-ship-shell, #wikinaut-jump-layer`) and set dynamic values on
  each host too (`Settings.applyToDom` does).
- Userscript runs on `en.wikipedia.org`; keep the `@match` scoped to article pages.

## Working in this repo: guidance for assistants

- **Backend changes** live in `sdow/` (Flask + search) and `scripts/` (graph build).
  Reuse the upstream BFS; don't rewrite it. The Dockerfile launches gunicorn with
  `--chdir /data --pythonpath /app sdow.server:app` so the DB resolves on the Fly volume
  without code edits.
- **The graph build is the risky area.** Any task touching dump processing must preserve
  the `linktarget` join (above) and stay Python 3 compatible.
- **Frontend changes** are in `wikinaut.user.js`. The high-value, high-difficulty code is
  the DOM link-matching (`Links`) and navigation (`Traversal`/`Transition`), not the
  pathfinding.
- **Verifying backend changes:** run `pytest tests/`. The suite covers shortest-path
  correctness, CSR/SQLite parity, malformed-request handling, the abuse limits, and
  search-log retention, all against the mock graph with no network access.
- **Verifying frontend changes:** there is no checked-in test suite for the userscript, and
  `node --check` only catches syntax. Real verification means driving the actual script with
  a throwaway Playwright harness against live `en.wikipedia.org`: shim `GM_*` (mock the
  `/paths` backend) via `addInitScript`, inject the script body with `page.evaluate`
  (bypasses Wikipedia's CSP, unlike `addScriptTag`), then assert on real flights: landings,
  statuses, storage, screenshots. Don't sign off frontend work on static reading alone.
- Keep the **FX/engine boundary** mechanically clean: `Figure`/`Trail`/`Transition`/
  `LaunchSequence`/`LinkFx`/`FxLoop`/`StarMap` must never call `Phase.set`, `setStatus`,
  `Storage.save/clear`, or `link.click()`. Grep for these in FX modules before finishing
  any frontend change.
- Stay in **Python** for backend work (project owner's primary language).

## Common commands

```bash
# Backend: set up environment (from repo root)
virtualenv env && source env/bin/activate && pip install -r requirements.txt

# Create a small mock graph for local dev (no full dump needed; also builds sdow/csr/ arrays)
python scripts/create_mock_databases.py

# Run the API server locally (from sdow/, which holds the mock sdow.sqlite/searches.sqlite/csr)
cd sdow/ && export FLASK_APP=server.py FLASK_DEBUG=1 && flask run

# Backend test suite (mock graph, no network)
pip install -r requirements-dev.txt && pytest tests/ -v

# Lint the userscript and the Python
node --check wikinaut.user.js
pycodestyle --config=setup.cfg sdow/ scripts/

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
```

## Operating the deployed Fly backend

`docs/web-server-setup.md` is the runbook and the single source of truth. Read Step 4 before
touching the volume. The short version of what bites: `server.py` opens both SQLite files at
import, so a missing one crash-loops the machine to `stopped` and `fly ssh console` cannot
attach; the fix is to keep the machine alive with
`fly machine update <id> -C "sleep infinity"` first and restore with `fly deploy` after.

## Upstream reference

- Forked from `jwngr/sdow` (Six Degrees of Wikipedia).
- `hut8/wikiwalk` (Rust) is a useful reference for the `linktarget` join logic.
