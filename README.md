# Wikinaut

**Wikinaut** is a space-themed navigation game for Wikipedia. Open the console on any Wikipedia
article, set a destination article, and Wikinaut charts the **shortest link-path** to it. Your ship
then flies you there, hop by hop, clicking through the real links on each live page until you
arrive.

It has two parts:

- **Userscript** (`wikinaut.user.js`): a Tampermonkey script that runs on Wikipedia, draws the
  console, takes a destination, and drives the link-by-link flight (with a hyperspace jump between
  pages).
- **Backend** (`sdow/`): a Python/Flask API, forked from
  [jwngr/sdow](https://github.com/jwngr/sdow) (Six Degrees of Wikipedia), that does the
  shortest-path search over the multi-gigabyte Wikipedia link graph. The browser cannot hold the
  graph, so the search lives here.

## Install the userscript

1. Install [Tampermonkey](https://www.tampermonkey.net/) (or another userscript manager).
2. Install **[`wikinaut.user.js`](./wikinaut.user.js)** (open the raw file; Tampermonkey offers to
   install it).
3. Open any English Wikipedia article. The Wikinaut console appears at the bottom.

It works out of the box against the hosted backend. To use your own backend instead, open the
console's **⚙ Settings → Backend URL** and paste your API's URL (for example your own Fly
deployment). The URL must be `https://`, or `http://` on localhost for development; your userscript
manager will ask you to approve the new host the first time Wikinaut calls it.

## How to play

1. **Set coordinates.** Type a destination article (autocomplete helps).
2. **Chart Course.** Wikinaut asks the backend for the shortest link-path and draws it as a star
   map. When several routes are equally short, the pager in the corner of the route card steps
   through them so you can pick one.
3. **Launch.** The ship flies to each next link on the page (scrolling it into view if needed) and
   jumps through hyperspace to the next article, repeating until you arrive.

If the live page no longer contains a link the graph expected, Wikinaut jumps straight to the
canonical article by URL and picks the flight back up on the next page.

Settings (**⚙**) persist across sessions: flight speed, the single ship color that drives every
color on the console, and the backend URL override.

## Known limitations

- **The graph is a dated snapshot.** Paths are computed from a fixed Wikipedia dump. Links added to
  live articles after that dump will not be flown; links removed since fall back to direct
  navigation.
- **English Wikipedia only.** The userscript is scoped to `en.wikipedia.org` and the shipped graph
  is English Wikipedia.
- **Searches are logged.** The backend records the source and target page IDs, duration, and result
  counts of every search (no IP address or user agent). Rows older than 90 days are pruned.

## Run / build the backend yourself

```bash
# From the repo root
virtualenv env && source env/bin/activate
pip install -r requirements.txt

# Create a tiny mock graph (no Wikipedia dump needed) for local dev.
# This also builds the CSR link arrays, so local dev runs the same search path as production.
python scripts/create_mock_databases.py

# Run the API locally (serves POST /paths and GET /ok on http://localhost:5000)
cd sdow/ && export FLASK_APP=server.py FLASK_DEBUG=1 && flask run
```

To build a real graph from a Wikipedia dump (hours; needs a high-memory machine and lots of disk):

```bash
cd scripts/ && ./buildDatabase.sh            # latest dump, or ./buildDatabase.sh <YYYYMMDD>
```

The build downloads the `page`, `redirect`, `pagelinks`, and `linktarget` dumps and processes them
into a single SQLite graph (`scripts/dump/wikinaut.sqlite`). See
[Data Source](./docs/data-source.md) for details.

## Deploy the backend

Wikinaut's backend is deployed to **Fly.io** as an always-on container with the SQLite graph on a
persistent volume. The repo ships a `Dockerfile` and `fly.toml`; see
**[Web server setup](./docs/web-server-setup.md)** for the full runbook: build the graph on GCE,
load it onto the Fly volume, then `fly deploy`.

## Algorithm

The Wikipedia link graph is unweighted, so the backend uses **bidirectional breadth-first search**,
running forward from the source and backward from the target and stopping when the frontiers meet.
It returns *all* equally-short paths between the two articles, which is what lets you choose a route
before launching. Neighbor lookups are served from memory-mapped CSR arrays when they are present,
falling back to the SQLite links table when they are not.

## Documentation

- [Web server setup](./docs/web-server-setup.md): deploy the backend to Fly.io.
- [Data Source](./docs/data-source.md): where the data comes from and how the graph is built.
- [Contributing](./.github/CONTRIBUTING.md): set up your machine to run Wikinaut locally.
- [CLAUDE.md](./CLAUDE.md): orientation for AI assistants working in this repo.

## Credits

Backend forked from [jwngr/sdow](https://github.com/jwngr/sdow) (Six Degrees of Wikipedia).
`LICENSE` carries the original copyright; Wikinaut's additions are released under the same terms.
