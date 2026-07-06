# Data Source & Database Build | Wikinaut

Wikinaut is a maintained fork of [Six Degrees of Wikipedia](https://github.com/jwngr/sdow) (SDOW).
This document is the **authoritative guide to building the SQLite link graph** that the backend
serves, updated for the mid-2024 Wikipedia `pagelinks` schema change that breaks upstream's build
scripts against current dumps.

## Table of contents

- [Data source](#data-source)
- [How this differs from upstream SDOW](#how-this-differs-from-upstream-sdow)
- [Prerequisites](#prerequisites)
- [Building the database](#building-the-database)
  - [Quick start](#quick-start)
  - [What the build produces](#what-the-build-produces)
  - [Validating the build](#validating-the-build)
  - [Troubleshooting](#troubleshooting)
- [Building on a cloud VM (GCE)](#building-on-a-cloud-vm-gce)
- [Database schema](#database-schema)
- [Historical search results](#historical-search-results)
- [Pre-built databases (upstream)](#pre-built-databases-upstream)

## Data source

Data for this project comes from Wikimedia, which creates [gzipped SQL dumps of the English language
Wikipedia database](https://dumps.wikimedia.org/enwiki) twice monthly. The Wikinaut SQLite database
is built by downloading, trimming, and parsing the following four SQL tables:

1.  [`page`](https://www.mediawiki.org/wiki/Manual:Page_table) — the ID and name (among other
    things) for all pages.
2.  [`pagelinks`](https://www.mediawiki.org/wiki/Manual:Pagelinks_table) — the source page and the
    **link target ID** for every link.
3.  [`linktarget`](https://www.mediawiki.org/wiki/Manual:Linktarget_table) — maps each link target
    ID to its namespace and title.
4.  [`redirect`](https://www.mediawiki.org/wiki/Manual:Redirect_table) — the source and target pages
    for all redirects.

Wikinaut only deals with actual Wikipedia articles, which in Wikipedia parlance means pages in
[namespace](https://en.wikipedia.org/wiki/Wikipedia:Namespace) `0`.

## How this differs from upstream SDOW

Before mid-2024, `pagelinks` stored link target titles directly (`pl_namespace` / `pl_title`).
**Around July 1, 2024, Wikipedia normalized this:** those columns were dropped and replaced by
`pl_target_id`, which references the new `linktarget` table. Upstream SDOW's build scripts assume the
old schema, so run against a current dump they **silently produce a broken graph** (no crash — just
empty/missing links).

Wikinaut's [`buildDatabase.sh`](../scripts/buildDatabase.sh) handles the new schema. It:

1. trims `pagelinks` to `<source page ID>\t<link target ID>` (namespace-0 sources only),
2. trims `linktarget` to `<link target ID>\t<page title>` (namespace-0 targets only), then
3. runs [`replace_link_targets_in_links_file.py`](../scripts/replace_link_targets_in_links_file.py)
   to join them and recreate the legacy `<source page ID>\t<page title>` links file that the rest of
   the pipeline consumes.

From that point on, the pipeline matches upstream. All build scripts run under **Python 3** (upstream
was Python 2). If you touch dump processing, **preserve this `linktarget` join.**

> The Rust project [`hut8/wikiwalk`](https://github.com/hut8/wikiwalk) is a useful reference for the
> same join logic.

## Prerequisites

The build runs on **GNU/Linux only** — `buildDatabase.sh` uses `grep -P` (PCRE) and GNU `sort -S`,
which the BSD tools on macOS lack. (Local development against the mock database works on macOS; see
[`CONTRIBUTING.md`](../.github/CONTRIBUTING.md).)

- **Tools on `PATH`:** `git`, `wget`, `pigz`, `sqlite3`, `python3`. `aria2c` is optional but
  recommended — the script uses it for the faster torrent download path and falls back to `wget`.

  ```bash
  sudo apt-get -q update
  sudo apt-get -yq install git wget pigz sqlite3 python3 aria2
  ```

- **Disk:** ~200 GB SSD. The dumps are only ~11 GB, but the pipeline keeps every multi-GB
  intermediate file plus the ~14 GB final SQLite and its `.gz`.
- **Memory:** ~32 GB is comfortable (64 GB is generous). The `linktarget` join holds the whole
  namespace-0 link-target map in RAM (**~4–7 GB resident**) and the build runs `sort -S 80%`. 16 GB
  works but sort spills to disk and it's tight.
- **Time:** roughly 2 hours end to end, dominated by the `pagelinks` processing and sorts.

## Building the database

### Quick start

```bash
cd scripts/
./buildDatabase.sh              # latest available dump
./buildDatabase.sh 20240701     # a specific dump, by YYYYMMDD
```

With no argument the script downloads the most recent dump listed at
<https://dumps.wikimedia.org/enwiki/>. All work happens in `scripts/dump/`.

### What the build produces

The final output is **`scripts/dump/wikinaut.sqlite`** (plus `wikinaut.sqlite.gz`). Note the app
itself opens the file as `sdow.sqlite`, so deployment renames it on the way onto the server volume —
see [`web-server-setup.md`](./web-server-setup.md).

The build is a pipeline of gzipped intermediate files, produced roughly in this order. Each stage is
guarded by `if [ ! -f <output> ]` and writes to a temp file it renames on success, so **re-running
the script skips completed stages** — it's safe to resume after an interruption:

| Stage | Files in `scripts/dump/` |
| --- | --- |
| Downloads | `enwiki-<date>-{sha1sums.txt, page.sql.gz, pagelinks.sql.gz, linktarget.sql.gz, redirect.sql.gz}` |
| Trimmed dumps | `pages.txt.gz`, `pagelinks.txt.gz`, `linktarget.txt.gz`, `redirects.txt.gz` |
| `linktarget` join | `links.txt.gz` |
| Titles → IDs | `redirects.with_ids.txt.gz`, `links.with_ids.txt.gz`, `pages.pruned.txt.gz` |
| Sorted | `links.sorted_by_{source,target}_id.txt.gz` |
| Grouped | `links.grouped_by_{source,target}_id.txt.gz` |
| Combined | `links.with_counts.txt.gz` |
| **Final** | **`wikinaut.sqlite`**, `wikinaut.sqlite.gz` |

To redo one stage, delete its output file under `dump/` and re-run. To rebuild from scratch, delete
the whole `dump/` directory.

### Validating the build

Sanity-check the finished database with a few queries (counts run into the millions for a full
English Wikipedia graph):

```bash
sqlite3 dump/wikinaut.sqlite "SELECT COUNT(*) FROM pages;"
sqlite3 dump/wikinaut.sqlite "SELECT COUNT(*) FROM links;"
sqlite3 dump/wikinaut.sqlite "SELECT COUNT(*) FROM redirects;"
# A known article should resolve, with is_redirect = 0:
sqlite3 dump/wikinaut.sqlite "SELECT id, title, is_redirect FROM pages WHERE title = 'Kevin_Bacon';"
```

For an end-to-end check that the graph actually answers path queries, point the backend at it and
hit `/paths` — see the smoke test in [`CONTRIBUTING.md`](../.github/CONTRIBUTING.md).

### Troubleshooting

- **`grep: invalid option -- P` / no matches (macOS):** the build is GNU/Linux-only. Run it on Linux
  (see [Building on a cloud VM](#building-on-a-cloud-vm-gce)).
- **`[ERROR] Downloaded <x> file has incorrect SHA-1 hash`:** a corrupt download. The script deletes
  the bad file and exits; just re-run to re-download it.
- **Out of disk:** the intermediates are large. Ensure ~200 GB free; delete the raw `*.sql.gz`
  downloads once trimming has completed if you're tight (they won't be regenerated unless you delete
  their trimmed outputs too).
- **Out of memory / OOM-killed during the join or a sort:** lower the sort buffer (`sort -S 80%` →
  a fixed size like `sort -S 8G`) or use a bigger machine — the `linktarget` join alone needs several
  GB resident.
- **Resuming:** the script is idempotent per stage (see the table above). A killed run picks up where
  it left off; a stage that was interrupted mid-write is re-done because its output is only renamed
  into place on success.

## Building on a cloud VM (GCE)

A full build wants a high-memory machine and lots of scratch disk. These steps use Google Compute
Engine, but any Linux VM meeting the [prerequisites](#prerequisites) works.

1.  Create a [Compute Engine instance](https://console.cloud.google.com/compute/instances):
    - **Machine type:** `e2-highmem-8` (8 vCPU / 64 GB) for a faster build, or `e2-highmem-4`
      (4 vCPU / 32 GB) for a cheaper one-off.
    - **Boot disk:** 200 GB+ SSD (`pd-ssd` or `pd-balanced`), recent Debian.
    - Allow read/write access to Cloud Storage if you'll stage the finished `wikinaut.sqlite` in a
      bucket for the deploy.

1.  (Optional) set a default region/zone for the `gcloud` CLI:

    ```bash
    gcloud config set compute/region us-central1
    gcloud config set compute/zone us-central1-c
    ```

1.  SSH into the machine:

    ```bash
    gcloud compute ssh wikinaut-db-builder-1 --project=wikinaut
    ```

1.  Install dependencies (see [Prerequisites](#prerequisites)):

    ```bash
    sudo apt-get -q update
    sudo apt-get -yq install git wget pigz sqlite3 python3 aria2
    ```

1.  Clone the repo and start a `screen` (or `tmux`) session so a dropped connection doesn't kill the
    build:

    ```bash
    git clone https://github.com/jackcareynapa/wikinaut.git
    cd wikinaut/scripts/
    screen        # then press <ENTER> on the screen that pops up
    ```

1.  Run the build, capturing output (provide an optional `YYYYMMDD` dump date):

    ```bash
    (time ./buildDatabase.sh [<YYYYMMDD>]) &> output.txt
    ```

1.  Detach from the screen with `<CTRL>+<a>` then `<d>`; reattach later with `screen -r`. Always
    detach cleanly so the session can be resumed.

1.  Wait ~2 hours, then [validate the build](#validating-the-build). Stage `dump/wikinaut.sqlite` to
    a bucket for deployment (see [`web-server-setup.md`](./web-server-setup.md)) and **delete the VM**
    to avoid ongoing charges.

## Database schema

The Wikinaut database (`wikinaut.sqlite`, opened by the app as `sdow.sqlite`) is a single SQLite file
containing three tables:

1.  `pages` — page information for all pages.
    1.  `id` — page ID.
    2.  `title` — [sanitized page title](https://www.mediawiki.org/wiki/Manual:Page_title).
    3.  `is_redirect` — whether the page is a redirect (`1`) or not (`0`).
2.  `links` — outgoing and incoming links for each non-redirect page.
    1.  `id` — page ID of the source page (the page that contains the link).
    2.  `outgoing_links_count` — number of pages this page links to.
    3.  `incoming_links_count` — number of pages that link to this page.
    4.  `outgoing_links` — `|`-separated list of page IDs this page links to.
    5.  `incoming_links` — `|`-separated list of page IDs that link to this page.
3.  `redirects` — source and target page IDs for all redirects.
    1.  `source_id` — page ID of the redirecting page.
    2.  `target_id` — page ID of the page it redirects to.

The table schemas live in [`sql/`](../sql/).

## Historical search results

Historical search results are stored in a **separate** SQLite database (`searches.sqlite`) with a
single `searches` table (schema in [`sql/createSearchesTable.sql`](../sql/createSearchesTable.sql)):

1.  `source_id` — page ID of the source page.
2.  `target_id` — page ID of the target page.
3.  `duration` — how long the search took, in seconds.
4.  `degrees_count` — number of degrees between source and target.
5.  `paths_count` — number of paths found.
6.  `paths` — stringified JSON of the page-ID paths.
7.  `t` — timestamp when the search finished.

Keeping search results in a separate file avoids locking the main graph database and makes it easy to
swap `sdow.sqlite` for a newer Wikipedia dump. Search results are not required to run the project and
are not published for download.

## Pre-built databases (upstream)

The upstream Six Degrees of Wikipedia project published pre-built SQLite databases on a
["requester pays"](https://cloud.google.com/storage/docs/requester-pays) Google Cloud Storage bucket
(`gs://sdow-prod/dumps/<YYYYMMDD>/sdow.sqlite.gz`), the most recent being `20231220` (~4.3 GB).
**These predate the 2024 `linktarget` schema change**, so they load and run but reflect a late-2023
snapshot of Wikipedia. For a current graph, [build your own](#building-the-database). The full
historical list and download details are in the [upstream repo](https://github.com/jwngr/sdow).

Example download (replace `<GCP_PROJECT_ID>` with your project ID; copying is free within GCP and
~\$0.05 per file otherwise):

```bash
gsutil -u <GCP_PROJECT_ID> cp gs://sdow-prod/dumps/20231220/sdow.sqlite.gz .
pigz -d sdow.sqlite.gz
```
