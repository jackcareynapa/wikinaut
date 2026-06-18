# Wikinaut

**Wikinaut** is a space-themed navigation game for Wikipedia. Open the console on any Wikipedia
article, set a destination article, and Wikinaut charts the **shortest link-path** to it — then
your ship flies you there, hop by hop, clicking through the real links on each live page until you
arrive.

It has two parts:

- **Userscript** (`wikinaut.user.js`) — a Tampermonkey script that runs on Wikipedia, draws the
  wireframe console, takes a destination, and drives the link-by-link flight (with a hyperspace
  jump between pages).
- **Backend** (`sdow/`) — a Python/Flask API, forked from
  [jwngr/sdow](https://github.com/jwngr/sdow) (Six Degrees of Wikipedia), that does the heavy
  shortest-path search over the multi-gigabyte Wikipedia link graph. The browser can't hold the
  graph, so the search lives here.

## Install the userscript

1. Install [Tampermonkey](https://www.tampermonkey.net/) (or another userscript manager).
2. Install **[`wikinaut.user.js`](./wikinaut.user.js)** (open the raw file; Tampermonkey offers to
   install it).
3. Open any English Wikipedia article — the Wikinaut console appears at the bottom.

It works out of the box against the hosted backend. To use your own backend instead, open the
console's **⚙ Settings → Backend URL** and paste your API's URL (e.g. a local `flask run`, or your
own Fly deployment).

## How to play

1. **Set coordinates** — type a destination article (autocomplete helps).
2. **Chart Course** — Wikinaut asks the backend for the shortest link-path and draws it as a star
   map.
3. **Launch** — the ship flies to each next link on the page (scrolling it into view if needed) and
   jumps through hyperspace to the next article, repeating until you arrive.

If the live page no longer contains a link the graph expected (Wikipedia changed since the graph was
built), Wikinaut flags the dead end so you can chart a fresh course from where you are.

## Run / build the backend yourself

```bash
# From the repo root
virtualenv env && source env/bin/activate
pip install -r requirements.txt

# Create a tiny mock graph (no Wikipedia dump needed) for local dev
python scripts/create_mock_databases.py

# Run the API locally (serves POST /paths and GET /ok on http://localhost:5000)
cd sdow/ && export FLASK_APP=server.py FLASK_DEBUG=1 && flask run
```

To build a real graph from a Wikipedia dump (hours; needs a high-memory machine and lots of disk):

```bash
cd scripts/ && ./buildDatabase.sh            # latest dump, or ./buildDatabase.sh <YYYYMMDD>
```

The build downloads the `page`, `redirect`, `pagelinks`, and `linktarget` dumps and processes them
into a single `sdow.sqlite`. See [Data Source](./docs/data-source.md) for details — including the
2024 `pagelinks` → `linktarget` schema change that Wikinaut's build pipeline handles.

## Deploy the backend

Wikinaut's backend is deployed to **Fly.io** as an always-on container with the SQLite graph on a
persistent volume. The repo ships a `Dockerfile` and `fly.toml`; see
**[Deployment](./docs/deployment.md)** for the full runbook (build the graph on GCE → load it onto
the Fly volume → `fly deploy`).

## Documentation

- [Deployment](./docs/deployment.md) — deploy the backend to Fly.io.
- [Data Source](./docs/data-source.md) — where the data comes from and how the graph is built.
- [Local Setup](./.github/CONTRIBUTING.md) — set up your machine to run Wikinaut locally.
- [Web Server Setup](./docs/web-server-setup.md) — the legacy nginx/gunicorn/supervisord VM setup.

## Algorithm

The Wikipedia link graph is unweighted, so the backend uses **bidirectional breadth-first search**
(forward from the source, backward from the target, stopping when the frontiers meet). It returns
*all* shortest paths, which is what lets the player choose between equally-short routes. See
[CLAUDE.md](./CLAUDE.md) for notes on why BFS — not Dijkstra/A\* or a language rewrite — is the right
tool here.

## Credits

- Backend forked from [jwngr/sdow](https://github.com/jwngr/sdow) (Six Degrees of Wikipedia).
- [`hut8/wikiwalk`](https://github.com/hut8/wikiwalk) is a useful reference for the modern
  `linktarget` join logic.
