"""
Wrapper for reading from and writing to the SDOW database.
"""

import os.path
import sqlite3
import urllib.parse
from collections import OrderedDict

import sdow.helpers as helpers
from sdow.breadth_first_search import breadth_first_search

# Maximum number of (source, target) -> paths results kept in the in-process LRU cache.
PATHS_CACHE_MAX_SIZE = 512

# Page-title lookups are chunked so the parameterized IN list stays well under SQLite's
# default 999-variable limit.
PAGE_TITLES_CHUNK_SIZE = 500


class Database(object):
  """Wrapper for connecting to the SDOW database."""

  def __init__(self, sdow_database, searches_database, link_source=None):
    # Both files must exist before the app can serve — a missing one crash-loops every worker.
    # See docs/web-server-setup.md, Step 4 ("Database location & creation") for the recovery
    # runbook (how to keep a crash-looping machine alive to load the volume).
    if not os.path.isfile(sdow_database):
      raise IOError(
          'Specified SQLite file "{0}" does not exist. See docs/web-server-setup.md Step 4.'
          .format(sdow_database))

    if not os.path.isfile(searches_database):
      raise IOError(
          'Specified SQLite file "{0}" does not exist. See docs/web-server-setup.md Step 4.'
          .format(searches_database))

    # The graph database is opened read-only and immutable: nothing writes it while serving, and
    # immutable=1 lets SQLite skip all locking/change detection. If the file is ever replaced
    # under a running server (see the web-server-setup.md runbook), the app must be restarted.
    self.sdow_conn = sqlite3.connect(
        'file:{0}?mode=ro&immutable=1'.format(urllib.parse.quote(sdow_database)),
        uri=True, check_same_thread=False)
    self.searches_conn = sqlite3.connect(searches_database, check_same_thread=False)

    self.sdow_cursor = self.sdow_conn.cursor()
    self.searches_cursor = self.searches_conn.cursor()

    self.sdow_cursor.arraysize = 1000
    self.searches_cursor.arraysize = 1000

    # mmap_size lets reads on the multi-GB graph go through the OS page cache instead of
    # SQLite's own read path (mmap is file-backed and shared — it does not count against RSS);
    # cache_size is 64 MB of page cache for the B-tree interior pages.
    self.sdow_cursor.execute('PRAGMA mmap_size = 1073741824;')
    self.sdow_cursor.execute('PRAGMA cache_size = -65536;')
    self.sdow_cursor.execute('PRAGMA temp_store = MEMORY;')

    # WAL keeps the per-request analytics INSERT from fsync-stalling a response.
    self.searches_cursor.execute('PRAGMA journal_mode = WAL;')
    self.searches_cursor.execute('PRAGMA synchronous = NORMAL;')

    self._paths_cache = OrderedDict()

    # BFS neighbor lookups go through link_source (e.g. a memory-mapped CSRGraph); when none is
    # provided, this Database serves links itself from the SQLite links table.
    self.link_source = link_source or self

  def fetch_page(self, page_title):
    """Returns the ID and title of the non-redirect page corresponding to the provided title,
    handling titles with incorrect capitalization as well as redirects.

    Args:
      page_title: The title of the page to fetch.

    Returns:
      (int, str, bool): A tuple containing the page ID, title, and whether or not a redirect was
      followed.
      OR
      None: If no page exists.

    Raises:
      ValueError: If the provided page title is invalid.
    """
    sanitized_page_title = helpers.get_sanitized_page_title(page_title)

    query = 'SELECT * FROM pages WHERE title = ? COLLATE NOCASE;'
    query_bindings = (sanitized_page_title,)
    self.sdow_cursor.execute(query, query_bindings)

    # Because the above query is case-insensitive (due to the COLLATE NOCASE), multiple articles
    # can be matched.
    results = self.sdow_cursor.fetchall()

    if not results:
      raise ValueError(
          'Invalid page title {0} provided. Page title does not exist.'.format(page_title))

    # First, look for a non-redirect page which has exact match with the page title.
    for current_page_id, current_page_title, current_page_is_redirect in results:
      if current_page_title == sanitized_page_title and not current_page_is_redirect:
        return (current_page_id, helpers.get_readable_page_title(current_page_title), False)

    # Next, look for a match with a non-redirect page.
    for current_page_id, current_page_title, current_page_is_redirect in results:
      if not current_page_is_redirect:
        return (current_page_id, helpers.get_readable_page_title(current_page_title), False)

    # If all the results are redirects, use the page to which the first result redirects.
    query = 'SELECT target_id, title FROM redirects INNER JOIN pages ON pages.id = target_id WHERE source_id = ?;'
    query_bindings = (results[0][0],)
    self.sdow_cursor.execute(query, query_bindings)

    result = self.sdow_cursor.fetchone()

    # This should be unreachable in a database built by the current pipeline: prune_pages_file.py
    # drops pages flagged as redirects with no corresponding redirects-table row. Kept as a guard
    # in case an older or hand-built database reaches this code path.
    if not result:
      raise ValueError(
          'Invalid page title {0} provided. Page title does not exist.'.format(page_title))

    return (result[0], helpers.get_readable_page_title(result[1]), True)

  def fetch_page_titles(self, page_ids):
    """Returns page info (title and URL) for the provided page IDs from the local pages table.

    Args:
      page_ids: An iterable of integer page IDs whose info to fetch.

    Returns:
      dict: A dictionary keyed by integer page ID, each value a dict with 'title' (human-readable)
        and 'url'. IDs not present in the pages table are omitted.
    """
    pages_info = {}
    page_ids = list(page_ids)

    for chunk_start in range(0, len(page_ids), PAGE_TITLES_CHUNK_SIZE):
      chunk = page_ids[chunk_start:chunk_start + PAGE_TITLES_CHUNK_SIZE]
      query = 'SELECT id, title FROM pages WHERE id IN ({0});'.format(
          ','.join('?' * len(chunk)))
      self.sdow_cursor.execute(query, chunk)

      for page_id, sanitized_title in self.sdow_cursor.fetchall():
        readable_title = helpers.get_readable_page_title(sanitized_title)
        pages_info[page_id] = {
            'title': readable_title,
            'url': 'https://en.wikipedia.org/wiki/{0}'.format(
                urllib.parse.quote(readable_title.replace(' ', '_'), safe="/:'()!,*~")),
        }

    return pages_info

  def compute_shortest_paths(self, source_page_id, target_page_id):
    """Returns a list of page IDs indicating the shortest path between the source and target pages.

    Results are memoized in an in-process LRU cache; the graph database is immutable while
    serving, so cached results never go stale within a process lifetime.

    Note: the provided page IDs must correspond to non-redirect pages, but that check is not made
    for performance reasons.

    Args:
      source_page_id: The ID corresponding to the page at which to start the search.
      target_page_id: The ID corresponding to the page at which to end the search.

    Returns:
      list(list(int)): A list of integer lists corresponding to the page IDs indicating the shortest path
        between the source and target page IDs.

    Raises:
      ValueError: If either of the provided page IDs are invalid.
    """
    helpers.validate_page_id(source_page_id)
    helpers.validate_page_id(target_page_id)

    cache_key = (source_page_id, target_page_id)
    cached_paths = self._paths_cache.get(cache_key)
    if cached_paths is not None:
      self._paths_cache.move_to_end(cache_key)
      return [list(path) for path in cached_paths]

    paths = breadth_first_search(source_page_id, target_page_id, self.link_source)

    self._paths_cache[cache_key] = tuple(tuple(path) for path in paths)
    if len(self._paths_cache) > PATHS_CACHE_MAX_SIZE:
      self._paths_cache.popitem(last=False)

    return paths

  def fetch_outgoing_links_count(self, page_ids):
    """Returns the sum of outgoing links of the provided page IDs.

    Args:
      page_ids: A list of page IDs whose outgoing links to count.

    Returns:
      int: The count of outgoing links.
    """
    return self.fetch_links_count_helper(page_ids, 'outgoing_links_count')

  def fetch_incoming_links_count(self, page_ids):
    """Returns the sum of incoming links for the provided page IDs.

    Args:
      page_ids: A list of page IDs whose incoming links to count.

    Returns:
      int: The count of incoming links.
    """
    return self.fetch_links_count_helper(page_ids, 'incoming_links_count')

  def fetch_links_count_helper(self, page_ids, incoming_or_outgoing_links_count):
    """Returns the sum of outgoing or incoming links for the provided page IDs.

    Args:
      page_ids: A list of page IDs whose outgoing or incoming links to count.

    Returns:
      int: The count of outgoing or incoming links.
    """
    page_ids = str(tuple(page_ids)).replace(',)', ')')

    # There is no need to escape the query parameters here since they are never user-defined.
    query = 'SELECT SUM({0}) FROM links WHERE id IN {1};'.format(
        incoming_or_outgoing_links_count, page_ids)
    self.sdow_cursor.execute(query)

    # SUM over zero rows is NULL; a page absent from the links table has zero links.
    return self.sdow_cursor.fetchone()[0] or 0

  def fetch_outgoing_links(self, page_ids):
    """Returns a list of tuples of page IDs representing outgoing links from the list of provided
    page IDs to other pages.

    Args:
      page_ids: A list of page IDs whose outgoing links to fetch.

    Returns:
      list(int, int): A lists of integer tuples representing outgoing links from the list of
        provided page IDs to other pages.
    """
    return self.fetch_links_helper(page_ids, 'outgoing_links')

  def fetch_incoming_links(self, page_ids):
    """Returns a list of tuples of page IDs representing incoming links from the list of provided
    page IDs to other pages.

    Args:
      page_ids: A list of page IDs whose incoming links to fetch.

    Returns:
      list(int, int): A lists of integer tuples representing incoming links from the list of
        provided page IDs to other pages.
    """
    return self.fetch_links_helper(page_ids, 'incoming_links')

  def fetch_links_helper(self, page_ids, outcoming_or_incoming_links):
    """Helper function which handles duplicate logic for fetch_outgoing_links() and
    fetch_incoming_links().

    Args:
      page_ids: A list of page IDs whose links to fetch.
      outcoming_or_incoming_links: String which indicates whether to fetch outgoing
        ("outgoing_links") or incoming ("incoming_links") links.

    Returns:
      iterable(int, list(int)): Tuples of a page ID and its integer neighbor IDs. The
        pipe-separated TEXT storage format is a detail of this SQLite adapter; CSRGraph serves
        the same contract from flat arrays.
    """
    # Snapshot the page IDs and run the query eagerly: the BFS passes a live dict-keys view and
    # clears the dict before iterating the result. Only the string parsing is lazy.
    #
    # Convert the page IDs into a string surrounded by parentheses for insertion into the query
    # below. The replace() bit is some hackery to handle Python printing a trailing ',' when there
    # is only one key.
    page_ids = str(tuple(page_ids)).replace(',)', ')')

    # There is no need to escape the query parameters here since they are never user-defined.
    query = 'SELECT id, {0} FROM links WHERE id IN {1};'.format(
        outcoming_or_incoming_links, page_ids)
    self.sdow_cursor.execute(query)
    rows = self.sdow_cursor.fetchall()

    return (
        (page_id, [int(token) for token in links_string.split('|') if token])
        for page_id, links_string in rows)

  def insert_result(self, search):
    """Inserts a new search result into the searches table.

    Args:
      results: A dictionary containing search information.

    Returns: 
      None
    """
    paths_count = len(search['paths'])

    if paths_count == 0:
      degrees_count = 'NULL'
    else:
      degrees_count = len(search['paths'][0]) - 1

    # There is no need to escape the query parameters here since they are never user-defined.
    query = 'INSERT INTO searches VALUES ({source_id}, {target_id}, {duration}, {degrees_count}, {paths_count}, CURRENT_TIMESTAMP);'.format(
        source_id=search['source_id'],
        target_id=search['target_id'],
        duration=search['duration'],
        degrees_count=degrees_count,
        paths_count=paths_count,
    )
    self.searches_conn.execute(query)
    self.searches_conn.commit()
