"""
Replaces page titles in the redirects file with their corresponding IDs.

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

SCRIPT_NAME = 'replace_titles_in_redirects_file'

# Create a set of all page IDs and a dictionary of page titles to their corresponding IDs.
ALL_PAGE_IDS = set()
PAGE_TITLES_TO_IDS = {}
for line in gzip.open(PAGES_FILE, 'rt', encoding='utf-8', errors='surrogateescape'):
    parts = line.rstrip('\n').split('\t')
    # Wikipedia dump pages rows always have 3 tab-separated fields; this guard skips
    # the rare malformed row (e.g. page 71701640) rather than silently using partial data.
    if len(parts) < 3:
        print(f'[WARN] {SCRIPT_NAME}: malformed pages row (expected 3 fields, got {len(parts)}): '
              f'{repr(line.rstrip(chr(10)))}', file=sys.stderr)
        continue
    page_id, page_title, _ = parts

    ALL_PAGE_IDS.add(page_id)
    PAGE_TITLES_TO_IDS[page_title] = page_id

# Create a dictionary of redirects, replace page titles in the redirects file with their
# corresponding IDs and ignoring pages which do not exist.
REDIRECTS = {}
skipped_redirects = 0
for line in gzip.open(REDIRECTS_FILE, 'rt', encoding='utf-8', errors='surrogateescape'):
  parts = line.rstrip('\n').split('\t')
  if len(parts) != 2:
    skipped_redirects += 1
    continue
  source_page_id, target_page_title = parts

  source_page_exists = source_page_id in ALL_PAGE_IDS
  target_page_id = PAGE_TITLES_TO_IDS.get(target_page_title)

  if source_page_exists and target_page_id is not None:
    REDIRECTS[source_page_id] = target_page_id
if skipped_redirects:
  print(f'[WARN] {SCRIPT_NAME}: skipped {skipped_redirects} malformed line(s) in redirects file',
        file=sys.stderr)

# Loop through the redirects dictionary and remove redirects which redirect to another redirect,
# writing the remaining redirects to stdout.
for source_page_id, target_page_id in REDIRECTS.items():
  start_target_page_id = target_page_id

  redirected_count = 0
  while target_page_id in REDIRECTS:
    target_page_id = REDIRECTS[target_page_id]

    redirected_count += 1

    # Break out if there is a circular path, meaning the redirects only point to other redirects,
    # not an acutal page.
    if target_page_id == start_target_page_id or redirected_count > 100:
      target_page_id = None

  if target_page_id is not None:
    print('\t'.join([source_page_id, target_page_id]))
