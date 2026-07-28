"""
Shared pytest fixtures for the sdow backend test suite.

Tests run against the small mock graph produced by scripts/create_mock_databases.py (the same
database used for local `flask run` development, see .github/CONTRIBUTING.md) rather than a full
Wikipedia dump. No network access is required or expected: page info is served entirely from the
local pages table.
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

  # The rate limiter stores counters in-process and this fixture is session-scoped, so leaving
  # it armed would let one test's requests eat another's budget. Tests that exercise throttling
  # turn it on through the rate_limited fixture below.
  server.app.config['RATELIMIT_ENABLED'] = False

  return server.app


@pytest.fixture()
def client(flask_app):
  return flask_app.test_client()


@pytest.fixture()
def rate_limited(flask_app):
  """Arms the rate limiter for one test, with counters cleared before and after."""
  from sdow import server

  flask_app.config['RATELIMIT_ENABLED'] = True
  server.limiter.reset()
  try:
    yield server.limiter
  finally:
    flask_app.config['RATELIMIT_ENABLED'] = False
    server.limiter.reset()
