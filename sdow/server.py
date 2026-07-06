"""
Server web framework.
"""

import time
import logging
import sqlite3

from flask_cors import CORS
from flask_compress import Compress
from flask import Flask, request, jsonify

from sdow.database import Database
from sdow.helpers import InvalidRequest, fetch_wikipedia_pages_info, is_str

# Log a warning for any /paths query slower than this. Observability only — does not change
# search behavior or cap query time; the BFS algorithm itself is untouched.
SLOW_QUERY_THRESHOLD_SECONDS = 2.0

# Connect to the SDOW database.
database = Database(sdow_database='./sdow.sqlite', searches_database='./searches.sqlite')

# Initialize the Flask app.
app = Flask(__name__)

app.config['JSONIFY_PRETTYPRINT_REGULAR'] = False

# Add support for cross-origin requests.
CORS(app)

# Add gzip compression.
Compress(app)


@app.errorhandler(500)
@app.errorhandler(Exception)
def unhandled_exception_handler(error):
  '''Unhandled exception handler.'''
  logging.exception('Internal server error: %s', {
      'error': error,
      'data': request.data
  }, stack_info=True)

  return jsonify({
      'error': 'An unexpected internal server error occurred. Please try again.',
      'code': 'internal',
  }), 500


@app.errorhandler(404)
@app.errorhandler(405)
def route_not_found_handler(error):
  '''Route not found handler.'''
  logging.debug('Route not found: {0} {1}'.format(request.method, request.path))
  return jsonify({
      'error': 'Route not found: {0} {1}'.format(request.method, request.path)
  }), 404


@app.errorhandler(InvalidRequest)
def invalid_request_handler(error):
  '''Invalid request handler.'''
  response = jsonify(error.to_dict())
  response.status_code = error.status_code
  return response


def _require_title(payload, field_name):
  '''Extracts and validates a non-empty string title from the request payload.

  Raises:
    InvalidRequest: If the field is missing or not a non-empty string.
  '''
  value = payload.get(field_name)
  if not is_str(value) or not value.strip():
    raise InvalidRequest(
        'Request must include a non-empty "{0}" page title.'.format(field_name),
        code='bad-request')
  return value


@app.route('/ok', methods=['GET'])
def ok_endpoint():
  '''Health check endpoint.'''
  return jsonify({
      'timestamp': int(round(time.time() * 1000))
  })


@app.route('/paths', methods=['POST'])
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
        page_ids_set.add(str(page_id))

    response['paths'] = paths
    response['pages'] = fetch_wikipedia_pages_info(list(page_ids_set), database)


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
