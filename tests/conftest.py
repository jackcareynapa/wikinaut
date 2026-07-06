"""
Shared pytest fixtures for the sdow backend test suite.

Tests run against the small mock graph produced by scripts/create_mock_databases.py (the same
database used for local `flask run` development, see .github/CONTRIBUTING.md) rather than a full
Wikipedia dump. No network access is required or expected: the fixture below stubs out the live
Wikipedia enrichment call so page-info lookups fall back to the mock database itself.
"""

import os
import sys
import subprocess

import pytest

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SDOW_DIR = os.path.join(REPO_ROOT, 'sdow')

if REPO_ROOT not in sys.path:
  sys.path.insert(0, REPO_ROOT)


@pytest.fixture(scope='session')
def flask_app():
  """Builds the mock databases and imports the Flask app against them.

  sdow/server.py opens './sdow.sqlite' and './searches.sqlite' relative to the current working
  directory at import time (mirroring how gunicorn/flask are run in production and local dev — see
  CONTRIBUTING.md). We chdir into sdow/ for the single import that establishes the connection.
  """
  subprocess.run(
      [sys.executable, os.path.join(REPO_ROOT, 'scripts', 'create_mock_databases.py')],
      check=True, cwd=REPO_ROOT, capture_output=True)

  old_cwd = os.getcwd()
  os.chdir(SDOW_DIR)
  try:
    from sdow import server
  finally:
    os.chdir(old_cwd)

  server.app.config['TESTING'] = True
  return server.app


@pytest.fixture()
def client(flask_app):
  return flask_app.test_client()


@pytest.fixture(autouse=True)
def no_network(monkeypatch):
  """Stubs the live Wikipedia API call so the test suite never makes real network requests.

  Simulating "API unreachable" also exercises the B5 fallback path (fetch_wikipedia_pages_info
  falling back to titles already stored in the database) on every test that finds a path.
  """
  from sdow import helpers
  monkeypatch.setattr(helpers, '_request_wikipedia_pages', lambda query_params: None)
