"""
Server web framework.
"""

import time
import logging
import sqlite3

from flask_cors import CORS
from flask_compress import Compress
from flask_limiter import Limiter
from flask import Flask, request, jsonify

from sdow.csr_graph import CSRGraph
from sdow.database import Database
from sdow.helpers import InvalidRequest, is_str

# Log a warning for any /paths query slower than this. Observability only — does not change
# search behavior or cap query time; the BFS algorithm itself is untouched.
SLOW_QUERY_THRESHOLD_SECONDS = 2.0

# The API is public and unauthenticated, and every accepted /paths request runs a bidirectional
# BFS over a multi-million-page graph, so the resource being protected is CPU on a small shared
# machine. The three limits below bound, in order: how much of a request body is read at all,
# how long a title may be, and how many searches one client may run.

# A /paths body is two short titles; 8 KB is generous. Flask rejects anything larger with a 413
# before request.get_json parses it, which also keeps oversized payloads out of the exception
# logger below (it records request.data).
MAX_REQUEST_BYTES = 8 * 1024

# Wikipedia's own limit is 255 bytes; anything longer cannot name a real page.
MAX_TITLE_LENGTH = 256

# Generous enough that no human playing Wikinaut will notice: charting a course is one request,
# and the userscript caches per-route lookups.
PATHS_RATE_LIMIT = '30 per minute, 500 per hour'

# Without this, INFO-level messages (the CSR-vs-fallback line below, slow-query context, ...)
# are silently dropped under gunicorn: Python's last-resort handler only emits WARNING+.
logging.basicConfig(level=logging.INFO)

# Connect to the SDOW database. BFS neighbor lookups prefer the memory-mapped CSR arrays
# (./csr resolves to /data/csr under gunicorn's --chdir /data); when the arrays are absent,
# CSRGraph.load returns None and the SQLite links table serves them instead.
database = Database(sdow_database='./sdow.sqlite', searches_database='./searches.sqlite',
                    link_source=CSRGraph.load('./csr'))

# Initialize the Flask app.
app = Flask(__name__)

app.config['JSONIFY_PRETTYPRINT_REGULAR'] = False
app.config['MAX_CONTENT_LENGTH'] = MAX_REQUEST_BYTES

# Add support for cross-origin requests.
CORS(app)

# Add gzip compression.
Compress(app)


def client_ip():
  '''Returns the calling client's IP address.

  The app runs behind Fly.io's edge proxy, so remote_addr is the proxy, not the caller;
  keying the rate limiter on it would lump every user into a single bucket. Fly sets
  Fly-Client-IP to the real peer. X-Forwarded-For is the fallback for other deployments
  (take the first entry: it is the original client, the rest are intermediate proxies).
  '''
  fly_client_ip = request.headers.get('Fly-Client-IP')
  if fly_client_ip:
    return fly_client_ip

  forwarded_for = request.headers.get('X-Forwarded-For')
  if forwarded_for:
    return forwarded_for.split(',')[0].strip()

  return request.remote_addr or 'unknown'


# Per-client throttle on the expensive endpoint. Storage is in-process, so each gunicorn
# worker counts separately and the effective limit is (workers x PATHS_RATE_LIMIT); that is
# accepted deliberately, since a shared store would mean running Redis for a single-machine
# app. Only /paths is limited: /ok must stay free for Fly's health check.
limiter = Limiter(key_func=client_ip, app=app, storage_uri='memory://')


@app.errorhandler(500)
@app.errorhandler(Exception)
def unhandled_exception_handler(error):
  '''Unhandled exception handler.'''
  # MAX_CONTENT_LENGTH already bounds the body at 8 KB; truncate again here so the log line
  # stays readable and a near-limit body cannot dominate the log stream.
  logging.exception('Internal server error: %s', {
      'error': error,
      'data': request.data[:512]
  }, stack_info=True)

  return jsonify({
      'error': 'An unexpected internal server error occurred. Please try again.',
      'code': 'internal',
  }), 500


@app.errorhandler(404)
def route_not_found_handler(error):
  '''Route not found handler.'''
  logging.debug('Route not found: {0} {1}'.format(request.method, request.path))
  return jsonify({
      'error': 'Route not found: {0} {1}'.format(request.method, request.path),
      'code': 'not-found',
  }), 404


@app.errorhandler(405)
def method_not_allowed_handler(error):
  '''Method not allowed handler.

  Reported separately from 404 so that POST-only /paths tells a caller the route exists but
  the method is wrong, rather than claiming the route is missing.
  '''
  return jsonify({
      'error': 'Method not allowed: {0} {1}'.format(request.method, request.path),
      'code': 'method-not-allowed',
  }), 405


@app.errorhandler(413)
def request_too_large_handler(error):
  '''Request body larger than MAX_CONTENT_LENGTH.'''
  return jsonify({
      'error': 'Request body must be smaller than {0} bytes.'.format(MAX_REQUEST_BYTES),
      'code': 'request-too-large',
  }), 413


@app.errorhandler(429)
def rate_limit_handler(error):
  '''Rate limit exceeded.'''
  return jsonify({
      'error': 'Too many searches. Please wait a moment and try again.',
      'code': 'rate-limited',
  }), 429


@app.errorhandler(InvalidRequest)
def invalid_request_handler(error):
  '''Invalid request handler.'''
  response = jsonify(error.to_dict())
  response.status_code = error.status_code
  return response


def _require_title(payload, field_name):
  '''Extracts and validates a non-empty string title from the request payload.

  Raises:
    InvalidRequest: If the field is missing, not a non-empty string, or too long to name a
      real Wikipedia page.
  '''
  value = payload.get(field_name)
  if not is_str(value) or not value.strip():
    raise InvalidRequest(
        'Request must include a non-empty "{0}" page title.'.format(field_name),
        code='bad-request')
  if len(value) > MAX_TITLE_LENGTH:
    raise InvalidRequest(
        'The "{0}" page title must be at most {1} characters.'.format(
            field_name, MAX_TITLE_LENGTH),
        code='bad-request')
  return value


@app.route('/ok', methods=['GET'])
def ok_endpoint():
  '''Health check endpoint.'''
  return jsonify({
      'timestamp': int(round(time.time() * 1000))
  })


@app.route('/paths', methods=['POST'])
@limiter.limit(PATHS_RATE_LIMIT)
def shortest_paths_route():
  """Endpoint which returns a list of shortest paths between two Wikipedia pages.

    Args:
      source: The title of the page at which to start the search.
      target: The title of the page at which to end the search.

    Returns:
      dict: A JSON-ified dictionary containing the shortest paths (represented by a list of lists of
            page IDs) and the corresponding pages data (represented by a dictionary of page IDs).

    Raises:
      InvalidRequest: If either of the provided titles correspond to pages which do not exist.
  """
  start_time = time.time()

  # A missing/non-JSON body or wrong Content-Type must not escape as a raw KeyError/TypeError
  # (which would fall through to the generic 500 handler); require it explicitly and reject it
  # as a 400 with a clear message.
  payload = request.get_json(silent=True)
  if not isinstance(payload, dict):
    raise InvalidRequest('Request body must be valid JSON.', code='no-content-type')

  source = _require_title(payload, 'source')
  target = _require_title(payload, 'target')

  try:
    # Look up the IDs for each page.
    try:
      (source_page_id, source_page_title, is_source_redirected) = database.fetch_page(source)
    except ValueError:
      raise InvalidRequest(
          'Start page "{0}" does not exist. Please try another search.'.format(source),
          code='page-not-found')

    try:
      (target_page_id, target_page_title, is_target_redirected) = database.fetch_page(target)
    except ValueError:
      raise InvalidRequest(
          'End page "{0}" does not exist. Please try another search.'.format(target),
          code='page-not-found')

    # Compute the shortest paths.
    paths = database.compute_shortest_paths(source_page_id, target_page_id)
  except sqlite3.Error as error:
    # Tagged distinctly from the generic exception handler so DB trouble (locked/corrupt/disk
    # full) is easy to tell apart from a code bug in the logs.
    logging.exception('[sqlite] database error while serving /paths: %s', error)
    raise InvalidRequest(
        'An unexpected internal server error occurred. Please try again.',
        status_code=500, code='internal')

  duration = time.time() - start_time
  if duration > SLOW_QUERY_THRESHOLD_SECONDS:
    logging.warning(
        'Slow /paths query (%.2fs): %s -> %s', duration, source_page_id, target_page_id)

  response = {
      'sourcePageTitle': source_page_title,
      'targetPageTitle': target_page_title,
      'isSourceRedirected': is_source_redirected,
      'isTargetRedirected': is_target_redirected,
  }

  # No paths found.
  if len(paths) == 0:
    logging.info('No paths found from {0} to {1}'.format(source_page_id, target_page_id))
    response['paths'] = []
    response['pages'] = {}
  # Paths found
  else:
    # Get a list of all IDs.
    page_ids_set = set()
    for path in paths:
      for page_id in path:
        page_ids_set.add(page_id)

    response['paths'] = paths
    # Titles come straight from the local pages table — no live Wikipedia call in the request
    # path. jsonify stringifies the integer keys, so the wire shape is unchanged.
    response['pages'] = database.fetch_page_titles(page_ids_set)

  try:
    database.insert_result({
      'source_id': source_page_id,
      'target_id': target_page_id,
      'duration': duration,
      'paths': paths,
    })
  except sqlite3.Error as e:
    logging.warning('[sqlite] failed to insert search result: {0}'.format(e))
  except Exception as e:
    # Log the error and continue; a logging failure must not fail an otherwise-successful search.
    logging.error('An unexpected error occurred while inserting result: {0}'.format(e))

  return jsonify(response)
