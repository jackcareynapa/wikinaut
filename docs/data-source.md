# Data Source | Six Degrees of Wikipedia

## Table of contents

- [Data Source](#data-source)
- [Get the Data Yourself](#get-the-data-yourself)
- [Database Schema](#database-schema)
- [Database Creation Script](#database-creation-script)
- [Historical Search Results](#historical-search-results)
- [Database Creation Process](#database-creation-process)

## Data source

Data for this project comes from Wikimedia, which creates [gzipped SQL dumps of the English language
Wikipedia database](https://dumps.wikimedia.org/enwiki) twice monthly. The Wikinaut SQLite database
is built by downloading, trimming, and parsing the following four SQL tables:

1.  [`page`](https://www.mediawiki.org/wiki/Manual:Page_table) - Contains the ID and name (among
    other things) for all pages.
2.  [`pagelinks`](https://www.mediawiki.org/wiki/Manual:Pagelinks_table) - Contains the source page
    and the **link target ID** for every link.
3.  [`linktarget`](https://www.mediawiki.org/wiki/Manual:Linktarget_table) - Maps each link target
    ID to its namespace and title.
4.  [`redirect`](https://www.mediawiki.org/wiki/Manual:Redirect_table) - Contains the source and
    target pages for all redirects.

Wikinaut only deals with actual Wikipedia pages, which in Wikipedia parlance means pages which
belong to [namespace](https://en.wikipedia.org/wiki/Wikipedia:Namespace) `0`.

### The 2024 `pagelinks` schema change

Before mid-2024, `pagelinks` stored link target titles directly (`pl_namespace` / `pl_title`).
**Around July 1, 2024, Wikipedia normalized this:** those columns were dropped and replaced by
`pl_target_id`, which references the new `linktarget` table. Upstream sdow's build scripts assumed
the old schema and silently produce a broken graph against current dumps.

Wikinaut's [`buildDatabase.sh`](../scripts/buildDatabase.sh) handles the new schema: it trims
`pagelinks` to `<source page ID>\t<link target ID>` and `linktarget` to
`<link target ID>\t<page title>` (namespace 0 only), then
[`replace_link_targets_in_links_file.py`](../scripts/replace_link_targets_in_links_file.py) joins
them to recreate the legacy `<source page ID>\t<page title>` links file the rest of the pipeline
consumes. All build scripts run under Python 3.

## Get the data yourself

> The downloadable snapshots below are **upstream Six Degrees of Wikipedia** databases (last updated
> December 2023) and pre-date the `linktarget` schema change. They still load fine if you just want a
> working graph quickly, but for a current graph build your own with `buildDatabase.sh` (see below)
> and deploy it per [`deployment.md`](./deployment.md).

Compressed versions of the upstream Six Degrees of Wikipedia SQLite database (`sdow.sqlite.gz`) are
available for download from
["requester pays"](https://cloud.google.com/storage/docs/requester-pays) Google Cloud Storage
buckets. Check the [pricing page](https://cloud.google.com/storage/pricing) for the
full details. In general, copying is free from within Google Cloud Platform (e.g., to another Google
Cloud Storage bucket or to a Google Cloud Engine VM) and around \$0.05 per compressed SQLite file
otherwise.

Use the following [`gsutil`](https://cloud.google.com/storage/docs/gsutil) and
[`pigz`](https://zlib.net/pigz/) commands to download a file, making sure to replace
`<GCP_PROJECT_ID>` with your Google Cloud Platform project ID and `<YYYYMMDD>` with the date of the
database dump:

```bash
$ gsutil -u <GCP_PROJECT_ID> cp gs://sdow-prod/dumps/<YYYYMMDD>/sdow.sqlite.gz .
$ pigz -d sdow.sqlite.gz
```

<details>
  <summary>
    Here is a list of historical Six Degrees of Wikipedia SQLite databases currently
    available for download:
  </summary>

- `gs://sdow-prod/dumps/20180201/sdow.sqlite.gz` (2.99 GB)
- `gs://sdow-prod/dumps/20180301/sdow.sqlite.gz` (3.01 GB)
- `gs://sdow-prod/dumps/20180401/sdow.sqlite.gz` (3.04 GB)
- `gs://sdow-prod/dumps/20180501/sdow.sqlite.gz` (3.06 GB)
- `gs://sdow-prod/dumps/20180601/sdow.sqlite.gz` (3.08 GB)
- `gs://sdow-prod/dumps/20180701/sdow.sqlite.gz` (3.10 GB)
- `gs://sdow-prod/dumps/20180801/sdow.sqlite.gz` (3.12 GB)
- `gs://sdow-prod/dumps/20180901/sdow.sqlite.gz` (3.14 GB)
- `gs://sdow-prod/dumps/20181001/sdow.sqlite.gz` (3.15 GB)
- `gs://sdow-prod/dumps/20181101/sdow.sqlite.gz` (3.17 GB)
- `gs://sdow-prod/dumps/20181201/sdow.sqlite.gz` (3.19 GB)
- `gs://sdow-prod/dumps/20190101/sdow.sqlite.gz` (3.21 GB)
- `gs://sdow-prod/dumps/20190201/sdow.sqlite.gz` (3.23 GB)
- `gs://sdow-prod/dumps/20190301/sdow.sqlite.gz` (3.24 GB)
- `gs://sdow-prod/dumps/20190401/sdow.sqlite.gz` (3.21 GB)
- `gs://sdow-prod/dumps/20190501/sdow.sqlite.gz` (3.23 GB)
- `gs://sdow-prod/dumps/20190601/sdow.sqlite.gz` (3.25 GB)
- `gs://sdow-prod/dumps/20190701/sdow.sqlite.gz` (3.26 GB)
- `gs://sdow-prod/dumps/20190801/sdow.sqlite.gz` (3.28 GB)
- `gs://sdow-prod/dumps/20190901/sdow.sqlite.gz` (3.31 GB)
- `gs://sdow-prod/dumps/20191001/sdow.sqlite.gz` (3.33 GB)
- `gs://sdow-prod/dumps/20191101/sdow.sqlite.gz` (3.35 GB)
- `gs://sdow-prod/dumps/20191201/sdow.sqlite.gz` (3.36 GB)
- `gs://sdow-prod/dumps/20200101/sdow.sqlite.gz` (3.38 GB)
- `gs://sdow-prod/dumps/20200201/sdow.sqlite.gz` (3.40 GB)
- `gs://sdow-prod/dumps/20200301/sdow.sqlite.gz` (3.41 GB)
- `gs://sdow-prod/dumps/20200401/sdow.sqlite.gz` (3.44 GB)
- `gs://sdow-prod/dumps/20200501/sdow.sqlite.gz` (3.47 GB)
- `gs://sdow-prod/dumps/20200601/sdow.sqlite.gz` (3.50 GB)
- `gs://sdow-prod/dumps/20200701/sdow.sqlite.gz` (3.53 GB)
- `gs://sdow-prod/dumps/20200801/sdow.sqlite.gz` (3.56 GB)
- `gs://sdow-prod/dumps/20200801/sdow.sqlite.gz` (3.59 GB)
- `gs://sdow-prod/dumps/20200901/sdow.sqlite.gz` (3.6 GB)
- `gs://sdow-prod/dumps/20201001/sdow.sqlite.gz` (3.6 GB)
- `gs://sdow-prod/dumps/20201101/sdow.sqlite.gz` (3.6 GB)
- `gs://sdow-prod/dumps/20201201/sdow.sqlite.gz` (3.6 GB)
- `gs://sdow-prod/dumps/20210101/sdow.sqlite.gz` (3.6 GB)
- Data missing from Feb 2021 - Nov 2023
- `gs://sdow-prod/dumps/20231220/sdow.sqlite.gz` (4.3 GB)
</details>

## Database schema

The Six Degrees of Wikipedia database is a single SQLite file containing the following three tables:

1.  `pages` - Page information for all pages.
    1.  `id` - Page ID.
    2.  `title` - [Sanitized page title](https://www.mediawiki.org/wiki/Manual:Page_title).
    3.  `is_redirect` - Whether or not the page is a redirect (`1` means it is a redirect; `0` means
        it is not)
2.  `links` - Outgoing and incoming links for each non-redirect page.
    1.  `id` - The page ID of the source page, the page that contains the link.
    2.  `outgoing_links_count` - The number of pages to which this page links to.
    3.  `incoming_links_count` - The number of pages which link to this page.
    4.  `outgoing_links` - A `|`-separated list of page IDs to which this page links.
    5.  `incoming_links` - A `|`-separated list of page IDs which link to this page.
3.  `redirects` - Source and target page IDs for all redirects.
    1.  `source_id` - The page ID of the source page, the page that redirects to another page.
    2.  `target_id` - The page ID of the target page, to which the redirect page redirects.

## Historical search results

Historical search results are stored in a separate SQLite database (`searches.sqlite`) which
contains a single `searches` table with the following schema:

1.  `source_id` - The page ID of the source page at which to start the search.
2.  `target_id` - The page ID of the target page at which to end the search.
3.  `duration` - How long the search took, in seconds.
4.  `degrees_count` - The number of degrees between the source and target pages.
5.  `paths_count` - The number of paths found between the source and target pages.
6.  `paths` - Stringified JSON representation of the paths of page IDs between the source and
    target pages.
7.  `t` - Timestamp when the search finished.

Search results are kept in a separate SQLite file to avoid locking the main `sdow.sqlite` database
as well as to make it easy to update the `sdow.sqlite` database to a more recent Wikipedia dump.

Historical search results are not available for public download, but they are not required to run
this project yourself.

## Database creation script

A new build of the Six Degrees of Wikipedia database is created using the [database creation shell
script](../scripts/buildDatabase.sh):

```bash
$ ./buildDatabase.sh
```

By default, it uses the most recent Wikipedia dump available, but it can download any available dump
by passing the date of the dump in the format `YYYYMMDD` as a command line argument:

```bash
$ ./buildDatabase.sh <YYYYMMDD>
```

## Database creation process

Generating the Six Degrees of Wikipedia database from a dump of Wikipedia takes approximately two
hours given the following instructions:

1.  Create a new [Google Compute Engine instance](https://console.cloud.google.com/compute/instances)
    with roughly the following specs:

    1.  **Machine Type:** `e2-highmem-8` (8 vCPU / 64 GB) for a faster build, or `e2-highmem-4`
        (4 vCPU / 32 GB) for a cheaper one-off. The memory headroom matters: the `linktarget` join
        holds the whole namespace-0 link-target map in RAM (~4–7 GB), and the build runs
        `sort -S 80%`. (16 GB also works, but sort spills to disk and it's tight.)
    1.  **Boot disk:** 200 GB+ SSD — the dumps are only ~11 GB, but the pipeline keeps every
        multi-GB intermediate file plus the final SQLite and its gzip. Recent Debian.
    1.  **Notes:** allow read/write access to Cloud Storage if you'll stage the finished
        `sdow.sqlite` in a bucket for the Fly deploy.

1.  Set the default region and zone for the `gcloud` CLI:

    ```
    $ gcloud config set compute/region us-central1
    $ gcloud config set compute/zone us-central1-c
    ```

1.  SSH into the machine:

    ```bash
    $ gcloud compute ssh sdow-db-builder-1 --project=sdow-prod
    ```

1.  Install required operating system dependencies:

    ```bash
    $ sudo apt-get -q update
    $ sudo apt-get -yq install git pigz sqlite3 python3 aria2
    ```

1.  Clone this repository via HTTPS:

    ```bash
    $ git clone https://github.com/jackcareynapa/wikinaut.git
    ```

1.  Move to the proper directory and create a new screen in case the VM connection is lost:

    ```bash
    $ cd wikinaut/scripts/
    $ screen  # And then press <ENTER> on the screen that pops up
    ```

1.  Run the database creation script, providing
    [an optional date](https://dumps.wikimedia.your.org/enwiki/) for the backup:

    ```bash
    $ (time ./buildDatabase.sh [<YYYYMMDD>]) &> output.txt
    ```

1.  Detach from the current screen session by pressing `<CTRL> + <a>` and then `<d>`. To reattach to
    the screen, run `screen -r`. Make sure to always detach from the screen cleanly so it can be
    resumed!

1.  Wait about two hours.

1.  SSH back into the machine if necessary:

    ```bash
    $ gcloud compute ssh sdow-db-builder-1 --project=sdow-prod
    ```

1.  Re-attach to the screen session:

    ```bash
    $ screen -r
    ```

1.  Copy the script output and the resulting SQLite file to the `sdow-prod` GCS bucket:

    ```bash
    $ ./uploadToGcs.sh YYYYMMDD
    ```

1.  Generate updated Wikipedia facts and copy them into the
    [corresponding JSON file](../website/src/resources/wikipediaFacts.json):

    ```bash
    $ python generate_updated_wikipedia_facts.py
    ```

1.  Delete the VM to prevent incurring large fees.
