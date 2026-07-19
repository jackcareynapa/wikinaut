"""
Prunes the pages file by removing pages which are marked as redirects but have no corresponding
redirect in the redirects file.

Output is written to stdout.
"""

import sys
import gzip

# Ensure stdout round-trips arbitrary page-title bytes safely.
sys.stdout.reconfigure(encoding='utf-8', errors='surrogateescape')

# Validate input arguments.
if len(sys.argv) < 3:
  print('[ERROR] Not enough arguments provided!')
  print('[INFO] Usage: {0} <pages_file> <redirects_file>'.format(sys.argv[0]))
  sys.exit(1)

PAGES_FILE = sys.argv[1]
REDIRECTS_FILE = sys.argv[2]

if not PAGES_FILE.endswith('.gz'):
  print('[ERROR] Pages file must be gzipped.')
  sys.exit(1)

if not REDIRECTS_FILE.endswith('.gz'):
  print('[ERROR] Redirects file must be gzipped.')
  sys.exit(1)

SCRIPT_NAME = 'prune_pages_file'

# Create a dictionary of redirects.
REDIRECTS = {}
skipped_redirects = 0
for line in gzip.open(REDIRECTS_FILE, 'rt', encoding='utf-8', errors='surrogateescape'):
  parts = line.rstrip('\n').split('\t')
  if len(parts) != 2:
    skipped_redirects += 1
    continue
  source_page_id, _ = parts
  REDIRECTS[source_page_id] = True
if skipped_redirects:
  print(f'[WARN] {SCRIPT_NAME}: skipped {skipped_redirects} malformed line(s) in redirects file',
        file=sys.stderr)

# Loop through the pages file, ignoring pages which are marked as redirects but which do not have a
# corresponding redirect in the redirects dictionary, printing the remaining pages to stdout.
for line in gzip.open(PAGES_FILE, 'rt', encoding='utf-8', errors='surrogateescape'):
  parts = line.rstrip('\n').split('\t')
  # Wikipedia dump pages rows always have 3 tab-separated fields; this guard skips
  # the rare malformed row (e.g. page 71701640) rather than crashing on strict unpacking.
  if len(parts) < 3:
    print(f'[WARN] {SCRIPT_NAME}: malformed pages row (expected 3 fields, got {len(parts)}): '
          f'{repr(line.rstrip(chr(10)))}', file=sys.stderr)
    continue
  page_id, page_title, is_redirect = parts

  if is_redirect == '0' or page_id in REDIRECTS:
    print('\t'.join([page_id, page_title, is_redirect]))
