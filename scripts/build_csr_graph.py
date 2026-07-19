"""
Builds the CSR (compressed sparse row) link-graph arrays from an SDOW SQLite database.

The links table stores adjacency as pipe-separated ID strings in TEXT columns; every BFS
neighbor fetch pays a B-tree walk plus string parsing. The CSR representation converts each
direction into two flat numpy arrays — one holding every neighbor ID contiguously, one holding
per-page offsets into it — so a neighbor lookup becomes a single contiguous slice. The server
memory-maps the arrays (sdow/csr_graph.py), so they are shared between workers through the OS
page cache and cost almost no RSS.

Artifact layout (written to <out_dir>):
  csr_ids.npy          uint32, sorted page IDs present in the links table
  csr_out_offsets.npy  int64, len(ids)+1; outgoing neighbors of ids[i] are
  csr_out_edges.npy    uint32                out_edges[out_offsets[i]:out_offsets[i+1]]
  csr_in_offsets.npy   int64, same shape for incoming links
  csr_in_edges.npy     uint32

Usage:
  python build_csr_graph.py <sdow.sqlite path> <output directory>

For English Wikipedia (~6M pages, ~150M links) the arrays total ~1.3 GB and the build takes
tens of minutes, dominated by parsing the pipe-separated strings.
"""

import os
import random
import sqlite3
import sys

import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))

from sdow.csr_graph import CSR_FILENAMES  # noqa: E402

# Number of random pages re-checked against SQLite after the build.
SPOT_CHECK_SAMPLES = 100


def _parse_links(links_string):
  """Parses a pipe-separated ID string into a uint32 array ('' -> empty)."""
  if not links_string:
    return np.empty(0, dtype=np.uint32)
  return np.array(links_string.split('|'), dtype=np.uint32)


def _write_edges(conn, column, ids, offsets, out_path):
  """Streams one direction's links strings into a memory-mapped edge array.

  Raises:
    ValueError: If a row's parsed link count disagrees with its counts column (offsets are
      derived from the counts columns, so a mismatch would silently corrupt the layout).
  """
  edges = np.lib.format.open_memmap(
      out_path, mode='w+', dtype=np.uint32, shape=(int(offsets[-1]),))

  cursor = conn.execute(
      'SELECT id, {0} FROM links ORDER BY id;'.format(column))
  row_index = 0
  for page_id, links_string in cursor:
    parsed = _parse_links(links_string)
    start, end = offsets[row_index], offsets[row_index + 1]
    if len(parsed) != end - start:
      raise ValueError(
          'links row id={0}: {1} has {2} entries but its count column says {3}'.format(
              page_id, column, len(parsed), end - start))
    edges[start:end] = parsed
    row_index += 1

  if row_index != len(ids):
    raise ValueError(
        'links table row count changed mid-build ({0} != {1})'.format(row_index, len(ids)))

  edges.flush()
  del edges


def _spot_check(conn, ids, offsets, edges, column):
  """Verifies a random sample of rows in the finished arrays against SQLite."""
  for row_index in random.sample(range(len(ids)), min(SPOT_CHECK_SAMPLES, len(ids))):
    page_id = int(ids[row_index])
    row = conn.execute(
        'SELECT {0} FROM links WHERE id = ?;'.format(column), (page_id,)).fetchone()
    expected = _parse_links(row[0])
    actual = edges[offsets[row_index]:offsets[row_index + 1]]
    if not np.array_equal(expected, actual):
      raise ValueError('spot check failed for page id {0} ({1})'.format(page_id, column))


def build_csr(sqlite_path, out_dir):
  """Builds all five CSR arrays from the provided SDOW database.

  Args:
    sqlite_path: Path to an sdow.sqlite-style database with a links table.
    out_dir: Directory to write the .npy files into (created if missing).
  """
  os.makedirs(out_dir, exist_ok=True)
  conn = sqlite3.connect('file:{0}?mode=ro'.format(sqlite_path), uri=True)

  # Pass 1: page IDs plus per-page counts -> offset arrays. The counts columns are produced by
  # the same pipeline as the links strings; pass 2 asserts they agree row by row.
  ids_list = []
  out_counts = []
  in_counts = []
  for page_id, outgoing_count, incoming_count in conn.execute(
      'SELECT id, outgoing_links_count, incoming_links_count FROM links ORDER BY id;'):
    ids_list.append(page_id)
    out_counts.append(outgoing_count)
    in_counts.append(incoming_count)

  ids = np.array(ids_list, dtype=np.uint32)
  del ids_list

  out_offsets = np.zeros(len(ids) + 1, dtype=np.int64)
  np.cumsum(out_counts, out=out_offsets[1:])
  in_offsets = np.zeros(len(ids) + 1, dtype=np.int64)
  np.cumsum(in_counts, out=in_offsets[1:])
  del out_counts, in_counts

  print('[INFO] build_csr_graph: {0} pages, {1} outgoing / {2} incoming links'.format(
      len(ids), out_offsets[-1], in_offsets[-1]))

  np.save(os.path.join(out_dir, 'csr_ids.npy'), ids)
  np.save(os.path.join(out_dir, 'csr_out_offsets.npy'), out_offsets)
  np.save(os.path.join(out_dir, 'csr_in_offsets.npy'), in_offsets)

  # Pass 2: stream each direction's strings into its memory-mapped edge array.
  _write_edges(conn, 'outgoing_links', ids, out_offsets,
               os.path.join(out_dir, 'csr_out_edges.npy'))
  _write_edges(conn, 'incoming_links', ids, in_offsets,
               os.path.join(out_dir, 'csr_in_edges.npy'))

  out_edges = np.load(os.path.join(out_dir, 'csr_out_edges.npy'), mmap_mode='r')
  in_edges = np.load(os.path.join(out_dir, 'csr_in_edges.npy'), mmap_mode='r')
  _spot_check(conn, ids, out_offsets, out_edges, 'outgoing_links')
  _spot_check(conn, ids, in_offsets, in_edges, 'incoming_links')

  conn.close()
  print('[INFO] build_csr_graph: wrote {0} to {1}'.format(', '.join(CSR_FILENAMES), out_dir))


if __name__ == '__main__':
  if len(sys.argv) != 3:
    print('Usage: {0} <sdow.sqlite path> <output directory>'.format(sys.argv[0]))
    sys.exit(1)
  build_csr(sys.argv[1], sys.argv[2])
