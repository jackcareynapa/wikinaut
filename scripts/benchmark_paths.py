"""
Benchmarks shortest-path searches over the SQLite links table vs. the CSR memmap arrays.

Generates a synthetic random graph (defaults: ~100k pages, ~2M links) in both storage formats
inside a temp directory, then times breadth_first_search over the same random page pairs through
each link source and reports p50/p95/mean per format.

The synthetic graph fits fully in the OS page cache, so this measures parsing/lookup overhead
only — the production win is larger still, because the real 14 GB SQLite file is disk-bound
while the ~1.3 GB CSR arrays stay resident.

Usage:
  python benchmark_paths.py [pages] [avg_degree] [searches]
"""

import os
import random
import sqlite3
import sys
import tempfile
import time
from collections import defaultdict

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))

from build_csr_graph import build_csr  # noqa: E402
from sdow.breadth_first_search import breadth_first_search  # noqa: E402
from sdow.csr_graph import CSRGraph  # noqa: E402
from sdow.database import Database  # noqa: E402

RANDOM_SEED = 20260709

DEFAULT_PAGES = 100_000
DEFAULT_AVG_DEGREE = 20
DEFAULT_SEARCHES = 100


def generate_graph(page_count, avg_degree, rng):
  """Returns {page_id: [outgoing ids]} for a random graph over IDs 1..page_count.

  Link targets are drawn from a Zipf-like popularity distribution (weight ~ 1/rank), mirroring
  Wikipedia: a few hub pages accumulate enormous incoming-link lists, and the backward BFS
  frontier hits them constantly. A uniform target distribution has no hubs and understates the
  difference between the storage formats.
  """
  pages = range(1, page_count + 1)
  cumulative_weights = []
  total = 0.0
  for rank in pages:
    total += 1.0 / rank
    cumulative_weights.append(total)

  outgoing = {}
  for page_id in pages:
    degree = rng.randint(1, 2 * avg_degree - 1)
    targets = rng.choices(pages, cum_weights=cumulative_weights, k=degree)
    outgoing[page_id] = sorted(set(targets) - {page_id})
  return outgoing


def write_sqlite(outgoing, sqlite_path):
  incoming = defaultdict(list)
  for source_id, targets in outgoing.items():
    for target_id in targets:
      incoming[target_id].append(source_id)

  conn = sqlite3.connect(sqlite_path)
  conn.execute(
      'CREATE TABLE links(id INTEGER PRIMARY KEY, outgoing_links_count INTEGER, '
      'incoming_links_count INTEGER, outgoing_links TEXT, incoming_links TEXT);')
  conn.executemany(
      'INSERT INTO links VALUES (?, ?, ?, ?, ?);',
      ((page_id,
        len(targets),
        len(incoming[page_id]),
        '|'.join(str(target_id) for target_id in targets),
        '|'.join(str(source_id) for source_id in incoming[page_id]))
       for page_id, targets in outgoing.items()))
  conn.commit()
  conn.close()


def time_searches(link_source, pairs):
  durations = []
  for source_id, target_id in pairs:
    started = time.perf_counter()
    breadth_first_search(source_id, target_id, link_source)
    durations.append(time.perf_counter() - started)
  return durations


def percentile(durations, fraction):
  ranked = sorted(durations)
  return ranked[min(len(ranked) - 1, int(len(ranked) * fraction))]


def report(label, durations):
  print('  {0:<8} p50 {1:7.2f} ms   p95 {2:7.2f} ms   mean {3:7.2f} ms'.format(
      label,
      percentile(durations, 0.50) * 1000,
      percentile(durations, 0.95) * 1000,
      sum(durations) / len(durations) * 1000))


def main(page_count, avg_degree, search_count):
  rng = random.Random(RANDOM_SEED)

  with tempfile.TemporaryDirectory(prefix='wikinaut-bench-') as temp_dir:
    sqlite_path = os.path.join(temp_dir, 'sdow.sqlite')
    searches_path = os.path.join(temp_dir, 'searches.sqlite')
    csr_dir = os.path.join(temp_dir, 'csr')

    print('[INFO] Generating synthetic graph: {0} pages, ~{1} links...'.format(
        page_count, page_count * avg_degree))
    outgoing = generate_graph(page_count, avg_degree, rng)

    print('[INFO] Writing SQLite links table...')
    write_sqlite(outgoing, sqlite_path)
    sqlite3.connect(searches_path).close()  # Database requires the file to exist.

    print('[INFO] Building CSR arrays...')
    build_csr(sqlite_path, csr_dir)

    database = Database(sqlite_path, searches_path)
    graph = CSRGraph.load(csr_dir)
    assert graph is not None

    pairs = [(rng.randint(1, page_count), rng.randint(1, page_count))
             for _ in range(search_count)]

    # Interleave a warm-up pass per source so first-touch costs don't skew either side.
    time_searches(database, pairs[:5])
    time_searches(graph, pairs[:5])

    print('[INFO] Timing {0} searches per link source...'.format(len(pairs)))
    sqlite_durations = time_searches(database, pairs)
    csr_durations = time_searches(graph, pairs)

    print()
    report('sqlite', sqlite_durations)
    report('csr', csr_durations)
    sqlite_mean = sum(sqlite_durations) / len(sqlite_durations)
    csr_mean = sum(csr_durations) / len(csr_durations)
    speedup = sqlite_mean / csr_mean
    print('  {0:<8} {1:.1f}x faster (mean)'.format('csr vs sqlite:', speedup))
    print()
    print('  NOTE: this synthetic graph fits in the OS page cache, so both sides run at RAM')
    print('  speed and the ratio above is the CPU-only floor. Production serves a 14 GB SQLite')
    print('  file from a 1 GB machine — those neighbor fetches are disk-bound B-tree walks,')
    print('  while the ~1.3 GB CSR arrays stay (mostly) resident. The deployed win is')
    print('  correspondingly larger, especially at the tail.')


if __name__ == '__main__':
  main(int(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_PAGES,
       int(sys.argv[2]) if len(sys.argv) > 2 else DEFAULT_AVG_DEGREE,
       int(sys.argv[3]) if len(sys.argv) > 3 else DEFAULT_SEARCHES)
