"""
Tests for the CSR (compressed sparse row) link graph: build correctness, full search parity with
the SQLite links table, and the fallback path when the arrays are absent.

Runs against the mock graph from scripts/create_mock_databases.py (layout documented in
test_paths_endpoint.py).
"""

import itertools
import os
import sqlite3
import sys

import pytest

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SDOW_DIR = os.path.join(REPO_ROOT, 'sdow')

if REPO_ROOT not in sys.path:
  sys.path.insert(0, REPO_ROOT)


@pytest.fixture(scope='module')
def csr_setup(tmp_path_factory):
  """Builds the mock database plus a fresh CSR artifact in a temp directory.

  Independent from the flask_app fixture so these tests control exactly which link source they
  exercise.
  """
  import subprocess
  subprocess.run(
      [sys.executable, os.path.join(REPO_ROOT, 'scripts', 'create_mock_databases.py')],
      check=True, cwd=REPO_ROOT, capture_output=True)

  sys.path.insert(0, os.path.join(REPO_ROOT, 'scripts'))
  from build_csr_graph import build_csr
  from sdow.csr_graph import CSRGraph

  sqlite_path = os.path.join(SDOW_DIR, 'sdow.sqlite')
  csr_dir = str(tmp_path_factory.mktemp('csr'))
  build_csr(sqlite_path, csr_dir)

  graph = CSRGraph.load(csr_dir)
  assert graph is not None

  return sqlite_path, csr_dir, graph


@pytest.fixture(scope='module')
def all_page_ids(csr_setup):
  """Every page ID in the mock pages table (redirects included)."""
  sqlite_path, _, _ = csr_setup
  conn = sqlite3.connect(sqlite_path)
  ids = [row[0] for row in conn.execute('SELECT id FROM pages;')]
  conn.close()
  return ids


@pytest.fixture(scope='module')
def sqlite_database(csr_setup):
  """A Database with no CSR link source (serves links from SQLite itself)."""
  from sdow.database import Database
  sqlite_path, _, _ = csr_setup
  return Database(sqlite_path, os.path.join(SDOW_DIR, 'searches.sqlite'))


# ---------------------------------------------------------------------------------------------
# Link-level parity: CSR arrays serve exactly what the SQLite links table serves
# ---------------------------------------------------------------------------------------------

def test_links_parity_over_all_pages(csr_setup, sqlite_database, all_page_ids):
  _, _, graph = csr_setup

  for page_id in all_page_ids:
    sqlite_out = dict(sqlite_database.fetch_outgoing_links([page_id]))
    csr_out = dict(graph.fetch_outgoing_links([page_id]))
    assert csr_out == sqlite_out, 'outgoing links diverge for page {0}'.format(page_id)

    sqlite_in = dict(sqlite_database.fetch_incoming_links([page_id]))
    csr_in = dict(graph.fetch_incoming_links([page_id]))
    assert csr_in == sqlite_in, 'incoming links diverge for page {0}'.format(page_id)


def test_links_count_parity_batched(csr_setup, sqlite_database, all_page_ids):
  _, _, graph = csr_setup

  # Whole-graph batch plus every single-page batch, both directions.
  batches = [all_page_ids] + [[page_id] for page_id in all_page_ids]
  for batch in batches:
    assert graph.fetch_outgoing_links_count(batch) == \
        sqlite_database.fetch_outgoing_links_count(batch)
    assert graph.fetch_incoming_links_count(batch) == \
        sqlite_database.fetch_incoming_links_count(batch)


def test_neighbor_ids_are_plain_python_ints(csr_setup):
  # BFS dict keys and the JSON-serialized paths must never be numpy scalars.
  _, _, graph = csr_setup
  for page_id, neighbors in graph.fetch_outgoing_links([22770]):
    assert type(page_id) is int
    for neighbor in neighbors:
      assert type(neighbor) is int


def test_absent_page_id_has_zero_links(csr_setup):
  _, _, graph = csr_setup

  # 999999999 has no row in the links table at all: it must be skipped entirely and count as
  # zero, matching the SQLite behaviors (empty IN match; `SUM(...) or 0`).
  assert graph.fetch_outgoing_links_count([999999999]) == 0
  assert graph.fetch_incoming_links_count([999999999]) == 0
  assert list(graph.fetch_outgoing_links([999999999])) == []
  assert list(graph.fetch_incoming_links([999999999])) == []

  # 19223527 (isolated page 14) has a links row with zero links: it must be yielded with an
  # empty neighbor list, exactly as the SQLite links table serves it.
  assert graph.fetch_outgoing_links_count([19223527]) == 0
  assert list(graph.fetch_outgoing_links([19223527])) == [(19223527, [])]
  assert list(graph.fetch_incoming_links([19223527])) == [(19223527, [])]


def test_live_dict_keys_view_is_snapshotted(csr_setup):
  # The BFS passes unvisited.keys() and clears the dict before iterating the result; the link
  # source must snapshot the IDs eagerly or every search silently finds nothing.
  _, _, graph = csr_setup
  frontier = {22770: [None]}
  links = graph.fetch_outgoing_links(frontier.keys())
  frontier.clear()
  assert dict(links) == {22770: [64516, 208161, 6412297, 208151]}


# ---------------------------------------------------------------------------------------------
# Search-level parity: identical shortest paths from both link sources over all page pairs
# ---------------------------------------------------------------------------------------------

def test_search_parity_over_all_page_pairs(csr_setup, sqlite_database, all_page_ids):
  from sdow.breadth_first_search import breadth_first_search
  _, _, graph = csr_setup

  def canonical(paths):
    return sorted(tuple(path) for path in paths)

  pair_count = 0
  for source_id, target_id in itertools.product(all_page_ids, repeat=2):
    sqlite_paths = breadth_first_search(source_id, target_id, sqlite_database)
    csr_paths = breadth_first_search(source_id, target_id, graph)
    assert canonical(csr_paths) == canonical(sqlite_paths), \
        'paths diverge for {0} -> {1}'.format(source_id, target_id)
    pair_count += 1

  assert pair_count == len(all_page_ids) ** 2


def test_search_parity_covers_interesting_shapes(csr_setup, all_page_ids):
  # The exhaustive sweep above must include: self-path, the isolated page, redirect IDs, and a
  # multi-path pair. This guards the fixture, not the search.
  assert 19223527 in all_page_ids  # isolated page 14
  assert 341668 in all_page_ids    # redirect page 30
  assert len(all_page_ids) == 35


# ---------------------------------------------------------------------------------------------
# Fallback and server wiring
# ---------------------------------------------------------------------------------------------

def test_load_returns_none_when_arrays_missing(tmp_path):
  from sdow.csr_graph import CSRGraph
  assert CSRGraph.load(str(tmp_path)) is None
  assert CSRGraph.load(str(tmp_path / 'does-not-exist')) is None


def test_database_serves_links_without_csr(sqlite_database):
  # With no link_source, Database is its own link source and searches still work.
  assert sqlite_database.link_source is sqlite_database
  paths = sqlite_database.compute_shortest_paths(22770, 208157)  # 1 -> 3 via 2
  assert paths == [[22770, 64516, 208157]]


def test_server_uses_csr_link_source(flask_app):
  # create_mock_databases.py builds sdow/csr/, so the imported server must actually be running
  # searches through CSRGraph, not the SQLite fallback.
  from sdow import server
  from sdow.csr_graph import CSRGraph
  assert isinstance(server.database.link_source, CSRGraph)
