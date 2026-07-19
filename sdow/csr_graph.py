"""
Memory-mapped CSR (compressed sparse row) view of the Wikipedia link graph.

Serves the same four link-fetch methods as Database (which reads pipe-separated ID strings out
of SQLite), but from flat numpy arrays produced by scripts/build_csr_graph.py: a neighbor
lookup is one binary search plus one contiguous slice instead of a B-tree walk plus string
parsing. The arrays are opened with mmap_mode='r', so both gunicorn workers share them through
the OS page cache and they cost almost no resident memory.

The server treats this class as optional: CSRGraph.load returns None when the arrays are
absent and Database then serves links itself (see server.py).
"""

import logging
import os.path

import numpy as np

# The five array files produced by scripts/build_csr_graph.py (which imports this tuple).
CSR_FILENAMES = (
    'csr_ids.npy',
    'csr_out_offsets.npy',
    'csr_out_edges.npy',
    'csr_in_offsets.npy',
    'csr_in_edges.npy',
)


class CSRGraph(object):
  """Read-only link-graph lookups over the memory-mapped CSR arrays."""

  def __init__(self, ids, out_offsets, out_edges, in_offsets, in_edges):
    self.ids = ids
    self.out_offsets = out_offsets
    self.out_edges = out_edges
    self.in_offsets = in_offsets
    self.in_edges = in_edges

  @classmethod
  def load(cls, directory):
    """Memory-maps the CSR arrays from the provided directory.

    Args:
      directory: Directory containing the five .npy files written by build_csr_graph.py.

    Returns:
      CSRGraph: A ready instance.
      OR
      None: If any array file is missing (the caller should fall back to SQLite links).
    """
    paths = [os.path.join(directory, filename) for filename in CSR_FILENAMES]
    if not all(os.path.isfile(path) for path in paths):
      logging.info(
          'CSR link arrays not found in %s; falling back to the SQLite links table.', directory)
      return None

    arrays = [np.load(path, mmap_mode='r') for path in paths]
    graph = cls(*arrays)
    logging.info(
        'Serving links from CSR arrays in %s (%d pages, %d outgoing / %d incoming links).',
        directory, len(graph.ids), graph.out_offsets[-1], graph.in_offsets[-1])
    return graph

  def _row_indices(self, page_ids):
    """Maps page IDs to row indices in the sorted ids array.

    Returns:
      (ndarray, ndarray): Row indices and a boolean mask of which requested IDs are present.
        Pages absent from the links table (no row index) have zero links.
    """
    requested = np.fromiter(page_ids, dtype=np.uint32)
    indices = np.searchsorted(self.ids, requested)
    indices_clipped = np.minimum(indices, len(self.ids) - 1)
    present = self.ids[indices_clipped] == requested
    return indices_clipped, present

  def _links_count(self, page_ids, offsets):
    indices, present = self._row_indices(page_ids)
    if not present.any():
      return 0
    rows = indices[present]
    return int(np.sum(offsets[rows + 1] - offsets[rows]))

  def _links(self, page_ids, offsets, edges):
    # Snapshot the page IDs and resolve rows eagerly: the BFS passes a live dict-keys view and
    # clears the dict before iterating the result. Only the edge-slice reads are lazy.
    page_ids = list(page_ids)
    indices, present = self._row_indices(page_ids)

    # .tolist() yields plain Python ints: BFS dict keys and the JSON-serialized paths must not
    # be numpy scalars.
    return (
        (page_id, edges[offsets[row]:offsets[row + 1]].tolist())
        for page_id, row, is_present in zip(page_ids, indices, present)
        if is_present)

  def fetch_outgoing_links_count(self, page_ids):
    """Returns the sum of outgoing links of the provided page IDs."""
    return self._links_count(page_ids, self.out_offsets)

  def fetch_incoming_links_count(self, page_ids):
    """Returns the sum of incoming links of the provided page IDs."""
    return self._links_count(page_ids, self.in_offsets)

  def fetch_outgoing_links(self, page_ids):
    """Yields (page_id, [outgoing neighbor IDs]) for each provided page present in the graph."""
    return self._links(page_ids, self.out_offsets, self.out_edges)

  def fetch_incoming_links(self, page_ids):
    """Yields (page_id, [incoming neighbor IDs]) for each provided page present in the graph."""
    return self._links(page_ids, self.in_offsets, self.in_edges)
