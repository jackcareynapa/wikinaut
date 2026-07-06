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
# B5: Wikipedia API outage falls back to the database rather than failing the response.
# ---------------------------------------------------------------------------------------------

def test_wikipedia_api_outage_falls_back_to_database_titles(client):
  # no_network (conftest, autouse) already simulates the API being unreachable for every test;
  # this test just makes the fallback assertion explicit and central.
  response = client.post('/paths', json={'source': '7', 'target': '8'})
  assert response.status_code == 200
  body = response.get_json()
  page = next(iter(body['pages'].values()))
  assert 'title' in page and 'url' in page
