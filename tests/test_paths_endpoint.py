"""
Tests for the /paths and /ok endpoints against the mock graph (scripts/create_mock_databases.py).

Mock graph summary (see that script for the authoritative layout):
  1 -> 2, 4, 5, 10        7 <-> 8            15 -> 16, 17
  2 -> 1, 3, 10           9 -> 3             16 -> 17, 18
  3 -> 4, 11              11 -> 12           17 -> 18
  4 -> 1, 6, 9            13 -> 12           18 -> 19
  5 -> 6                  14 -> (isolated)   19 -> 20
  Pages 30-34 are redirects to page 1. Page 35 is flagged is_redirect with no redirects-table row
  (exercises the "redirect flag but no redirect row" guard in Database.fetch_page).
"""

import sqlite3

import pytest


# ---------------------------------------------------------------------------------------------
# T1: shortest-path correctness
# ---------------------------------------------------------------------------------------------

def test_direct_link_one_hop(client):
  response = client.post('/paths', json={'source': '1', 'target': '2'})
  assert response.status_code == 200
  body = response.get_json()
  assert body['sourcePageTitle'] == '1'
  assert body['targetPageTitle'] == '2'
  assert body['isSourceRedirected'] is False
  assert body['isTargetRedirected'] is False
  assert len(body['paths']) == 1
  assert len(body['paths'][0]) == 2
  # Page-info enrichment (network stubbed) falls back to titles from the mock database.
  source_id, target_id = body['paths'][0]
  assert body['pages'][str(source_id)]['title'] == '1'
  assert body['pages'][str(target_id)]['title'] == '2'


def test_two_hop_single_shortest_path(client):
  response = client.post('/paths', json={'source': '1', 'target': '3'})
  assert response.status_code == 200
  body = response.get_json()
  assert len(body['paths']) == 1
  assert len(body['paths'][0]) == 3
  middle_id = body['paths'][0][1]
  assert body['pages'][str(middle_id)]['title'] == '2'


def test_all_equal_shortest_paths_returned(client):
  # 15 -> 16 -> 18 and 15 -> 17 -> 18 are both shortest (length 2); both must be returned.
  response = client.post('/paths', json={'source': '15 (number)', 'target': '18 (number)'})
  assert response.status_code == 200
  body = response.get_json()
  assert len(body['paths']) == 2
  for path in body['paths']:
    assert len(path) == 3
  middle_titles = {
      body['pages'][str(path[1])]['title'] for path in body['paths']
  }
  assert middle_titles == {'16 (number)', '17 (number)'}


def test_source_equals_target_returns_single_node_path(client):
  response = client.post('/paths', json={'source': '1', 'target': '1'})
  assert response.status_code == 200
  body = response.get_json()
  assert len(body['paths']) == 1
  assert len(body['paths'][0]) == 1


def test_redirect_as_source_resolves_to_canonical_page(client):
  response = client.post('/paths', json={'source': '30 (number)', 'target': '2'})
  assert response.status_code == 200
  body = response.get_json()
  assert body['sourcePageTitle'] == '1'
  assert body['isSourceRedirected'] is True
  assert len(body['paths']) == 1
  assert len(body['paths'][0]) == 2


def test_disconnected_pair_returns_no_paths(client):
  # Page 14 has no incoming or outgoing links in the mock graph.
  response = client.post('/paths', json={'source': '14 (number)', 'target': '1'})
  assert response.status_code == 200
  body = response.get_json()
  assert body['paths'] == []
  assert body['pages'] == {}


def test_ok_endpoint(client):
  response = client.get('/ok')
  assert response.status_code == 200
  assert 'timestamp' in response.get_json()


# ---------------------------------------------------------------------------------------------
# T2: malformed requests -> 400, not 500 (regression test for B1)
# ---------------------------------------------------------------------------------------------

def test_no_body_is_400_not_500(client):
  response = client.post('/paths')
  assert response.status_code == 400
  assert response.get_json()['code'] == 'no-content-type'


def test_non_json_body_is_400_not_500(client):
  response = client.post('/paths', data='not json', content_type='application/json')
  assert response.status_code == 400
  assert response.get_json()['code'] == 'no-content-type'


def test_empty_object_is_400(client):
  response = client.post('/paths', json={})
  assert response.status_code == 400
  body = response.get_json()
  assert body['code'] == 'bad-request'
  assert 'source' in body['error']


def test_missing_target_is_400(client):
  response = client.post('/paths', json={'source': '1'})
  assert response.status_code == 400
  body = response.get_json()
  assert body['code'] == 'bad-request'
  assert 'target' in body['error']


def test_non_string_title_is_400(client):
  response = client.post('/paths', json={'source': 123, 'target': '1'})
  assert response.status_code == 400
  assert response.get_json()['code'] == 'bad-request'


def test_nonexistent_title_is_400_page_not_found(client):
  response = client.post('/paths', json={'source': 'Definitely Not A Real Page Title XYZ',
                                         'target': '1'})
  assert response.status_code == 400
  assert response.get_json()['code'] == 'page-not-found'


# ---------------------------------------------------------------------------------------------
# T2b: abuse limits. /paths is public, unauthenticated, and runs a BFS per call, so oversized
# and over-frequent requests must be turned away before they reach the search.
# ---------------------------------------------------------------------------------------------

def test_oversized_body_is_413_not_500(client):
  from sdow import server

  oversized = 'x' * (server.MAX_REQUEST_BYTES + 1)
  response = client.post('/paths', data=oversized, content_type='application/json')
  assert response.status_code == 413
  assert response.get_json()['code'] == 'request-too-large'


def test_over_long_title_is_400(client):
  from sdow import server

  long_title = 'A' * (server.MAX_TITLE_LENGTH + 1)
  response = client.post('/paths', json={'source': long_title, 'target': '1'})
  assert response.status_code == 400
  body = response.get_json()
  assert body['code'] == 'bad-request'
  assert 'source' in body['error']


def test_title_at_length_limit_is_accepted(client):
  """The bound rejects only what is longer than a real title, not the boundary itself."""
  from sdow import server

  at_limit = 'A' * server.MAX_TITLE_LENGTH
  response = client.post('/paths', json={'source': at_limit, 'target': '1'})
  # Reaches the lookup and fails there (no such page) rather than being rejected as malformed.
  assert response.status_code == 400
  assert response.get_json()['code'] == 'page-not-found'


def test_wrong_method_on_paths_is_405_not_404(client):
  response = client.get('/paths')
  assert response.status_code == 405
  assert response.get_json()['code'] == 'method-not-allowed'


def test_unknown_route_is_still_404(client):
  response = client.get('/no-such-route')
  assert response.status_code == 404
  assert response.get_json()['code'] == 'not-found'


def test_rate_limit_returns_429_once_the_budget_is_spent(client, rate_limited):
  from sdow import server

  per_minute = int(server.PATHS_RATE_LIMIT.split(' per minute')[0])

  # The budget itself must be usable in full.
  for _ in range(per_minute):
    assert client.post('/paths', json={'source': '1', 'target': '2'}).status_code == 200

  response = client.post('/paths', json={'source': '1', 'target': '2'})
  assert response.status_code == 429
  assert response.get_json()['code'] == 'rate-limited'


def test_rate_limit_is_keyed_per_client_ip(client, rate_limited):
  """Fly's proxy is the peer for every request, so the limiter must read the forwarded IP.

  Without this, all users share one bucket and a single busy client throttles everyone.
  """
  from sdow import server

  per_minute = int(server.PATHS_RATE_LIMIT.split(' per minute')[0])
  noisy = {'Fly-Client-IP': '203.0.113.7'}

  for _ in range(per_minute):
    assert client.post('/paths', json={'source': '1', 'target': '2'},
                       headers=noisy).status_code == 200
  assert client.post('/paths', json={'source': '1', 'target': '2'},
                     headers=noisy).status_code == 429

  # A different client is unaffected by the noisy one having spent its budget.
  quiet = {'Fly-Client-IP': '198.51.100.4'}
  assert client.post('/paths', json={'source': '1', 'target': '2'},
                     headers=quiet).status_code == 200


def test_health_check_is_not_rate_limited(client, rate_limited):
  """Fly polls /ok every 30s; throttling it would take the machine down."""
  from sdow import server

  per_minute = int(server.PATHS_RATE_LIMIT.split(' per minute')[0])
  for _ in range(per_minute + 5):
    assert client.get('/ok').status_code == 200


def test_client_ip_prefers_fly_header_then_forwarded_for(flask_app):
  from sdow import server

  with flask_app.test_request_context(headers={'Fly-Client-IP': '203.0.113.7',
                                               'X-Forwarded-For': '198.51.100.4, 10.0.0.1'}):
    assert server.client_ip() == '203.0.113.7'

  # Falls back to the first X-Forwarded-For entry (the original client) off Fly.
  with flask_app.test_request_context(headers={'X-Forwarded-For': '198.51.100.4, 10.0.0.1'}):
    assert server.client_ip() == '198.51.100.4'


# ---------------------------------------------------------------------------------------------
# B4/B6: sqlite errors are tagged and don't leak as opaque crashes; insert failures don't fail
# an otherwise-successful search.
# ---------------------------------------------------------------------------------------------

def test_sqlite_error_during_search_returns_tagged_500(client, flask_app, monkeypatch, caplog):
  from sdow import server

  def raise_locked(*args, **kwargs):
    raise sqlite3.OperationalError('database is locked')

  monkeypatch.setattr(server.database, 'compute_shortest_paths', raise_locked)

  with caplog.at_level('ERROR'):
    response = client.post('/paths', json={'source': '1', 'target': '2'})

  assert response.status_code == 500
  body = response.get_json()
  assert body['code'] == 'internal'
  assert 'database is locked' not in body['error']  # internals not leaked to the player
  assert any('[sqlite]' in record.message for record in caplog.records)


def test_insert_result_sqlite_failure_does_not_fail_the_search(client, flask_app, monkeypatch):
  from sdow import server

  def raise_locked(*args, **kwargs):
    raise sqlite3.OperationalError('database is locked')

  monkeypatch.setattr(server.database, 'insert_result', raise_locked)

  response = client.post('/paths', json={'source': '1', 'target': '2'})
  assert response.status_code == 200
  assert len(response.get_json()['paths']) == 1


# ---------------------------------------------------------------------------------------------
# The search log is an append-only analytics table sharing a volume with the multi-GB graph, so
# it is pruned rather than allowed to grow without bound.
# ---------------------------------------------------------------------------------------------

def test_prune_old_searches_drops_only_rows_past_the_retention_window(flask_app):
  from sdow import database as database_module
  from sdow import server

  conn = server.database.searches_conn
  retention_days = database_module.SEARCHES_RETENTION_DAYS

  conn.execute('DELETE FROM searches;')
  # One row just inside the window and one just outside it.
  conn.execute(
      "INSERT INTO searches VALUES (1, 2, 0.1, 1, 1, datetime('now', ?));",
      ('-{0} days'.format(retention_days - 1),))
  conn.execute(
      "INSERT INTO searches VALUES (3, 4, 0.1, 1, 1, datetime('now', ?));",
      ('-{0} days'.format(retention_days + 1),))
  conn.commit()

  deleted = server.database.prune_old_searches()

  assert deleted == 1
  remaining = conn.execute('SELECT source_id FROM searches;').fetchall()
  assert [row[0] for row in remaining] == [1]


def test_insert_result_records_null_degrees_for_an_unreachable_pair(flask_app):
  """Regression guard for the parameterized INSERT: a no-paths search stores SQL NULL."""
  from sdow import server

  conn = server.database.searches_conn
  conn.execute('DELETE FROM searches;')
  conn.commit()

  server.database.insert_result(
      {'source_id': 14, 'target_id': 20, 'duration': 0.5, 'paths': []})

  row = conn.execute(
      'SELECT degrees_count, paths_count FROM searches WHERE source_id = 14;').fetchone()
  assert row == (None, 0)


# ---------------------------------------------------------------------------------------------
# Page info is served entirely from the local pages table — no live Wikipedia call in the
# request path.
# ---------------------------------------------------------------------------------------------

def test_pages_info_comes_from_local_database(client):
  response = client.post('/paths', json={'source': '7', 'target': '8'})
  assert response.status_code == 200
  body = response.get_json()
  assert len(body['pages']) == 2
  for page in body['pages'].values():
    assert 'title' in page and 'url' in page
    assert page['url'].startswith('https://en.wikipedia.org/wiki/')


# ---------------------------------------------------------------------------------------------
# The in-process LRU result cache: a repeated identical query must not rerun the BFS.
# ---------------------------------------------------------------------------------------------

def test_repeated_search_is_served_from_cache(client, monkeypatch):
  from sdow import database as database_module
  from sdow import server

  bfs_calls = []
  real_bfs = database_module.breadth_first_search

  def counting_bfs(source_page_id, target_page_id, database):
    bfs_calls.append((source_page_id, target_page_id))
    return real_bfs(source_page_id, target_page_id, database)

  monkeypatch.setattr(database_module, 'breadth_first_search', counting_bfs)
  # Evict any entry earlier tests left for this pair so the first request below really runs BFS.
  server.database._paths_cache.clear()

  first = client.post('/paths', json={'source': '5', 'target': '6'})
  second = client.post('/paths', json={'source': '5', 'target': '6'})

  assert first.status_code == 200 and second.status_code == 200
  assert first.get_json()['paths'] == second.get_json()['paths']
  assert len(bfs_calls) == 1


def test_cached_result_is_not_aliased(client):
  # Mutating one response's paths (list(list(int))) must not corrupt the cached copy.
  from sdow import server

  source_id = server.database.fetch_page('1')[0]
  target_id = server.database.fetch_page('3')[0]

  server.database._paths_cache.clear()
  first = server.database.compute_shortest_paths(source_id, target_id)
  first[0][0] = 999999
  second = server.database.compute_shortest_paths(source_id, target_id)
  assert second[0][0] == source_id
