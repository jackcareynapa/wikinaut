"""
Replaces page names in the links file with their corresponding IDs, eliminates links containing
non-existing pages, and replaces redirects with the pages to which they redirect.

Output is written to stdout.
"""

import sys
import gzip

# Ensure stdout round-trips arbitrary page-title bytes safely.
sys.stdout.reconfigure(encoding='utf-8', errors='surrogateescape')

# Validate inputs
if len(sys.argv) < 4:
  print('[ERROR] Not enough arguments provided!')
  print('[INFO] Usage: {0} <pages_file> <redirects_file> <links_file>'.format(sys.argv[0]))
  sys.exit(1)

PAGES_FILE = sys.argv[1]
REDIRECTS_FILE = sys.argv[2]
LINKS_FILE = sys.argv[3]

if not PAGES_FILE.endswith('.gz'):
  print('[ERROR] Pages file must be gzipped.')
  sys.exit(1)

if not REDIRECTS_FILE.endswith('.gz'):
  print('[ERROR] Redirects file must be gzipped.')
  sys.exit(1)

if not LINKS_FILE.endswith('.gz'):
  print('[ERROR] Links file must be gzipped.')
  sys.exit(1)

SCRIPT_NAME = 'replace_titles_and_redirects_in_links_file'

# Create a set of all page IDs and a dictionary of page titles to their corresponding IDs.
ALL_PAGE_IDS = set()
PAGE_TITLES_TO_IDS = {}
for line in gzip.open(PAGES_FILE, 'rt', encoding='utf-8', errors='surrogateescape'):
  parts = line.rstrip('\n').split('\t')
  # Wikipedia dump pages rows always have 3 tab-separated fields; this guard skips
  # the rare malformed row (e.g. page 71701640) rather than processing with partial data.
  if len(parts) < 3:
    print(f'[WARN] {SCRIPT_NAME}: malformed pages row (expected 3 fields, got {len(parts)}): '
          f'{repr(line.rstrip(chr(10)))}', file=sys.stderr)
    continue
  page_id, page_title, _ = parts

  ALL_PAGE_IDS.add(page_id)
  PAGE_TITLES_TO_IDS[page_title] = page_id

# Create a dictionary of page IDs to the target page ID to which they redirect.
REDIRECTS = {}
skipped_redirects = 0
for line in gzip.open(REDIRECTS_FILE, 'rt', encoding='utf-8', errors='surrogateescape'):
  parts = line.rstrip('\n').split('\t')
  if len(parts) != 2:
    skipped_redirects += 1
    continue
  source_page_id, target_page_id = parts
  REDIRECTS[source_page_id] = target_page_id
if skipped_redirects:
  print(f'[WARN] {SCRIPT_NAME}: skipped {skipped_redirects} malformed line(s) in redirects file',
        file=sys.stderr)

# Loop through each line in the links file, replacing titles with IDs, applying redirects, and
# removing nonexistent pages, writing the result to stdout.
skipped_links = 0
for line in gzip.open(LINKS_FILE, 'rt', encoding='utf-8', errors='surrogateescape'):
  parts = line.rstrip('\n').split('\t')
  if len(parts) != 2:
    skipped_links += 1
    continue
  source_page_id, target_page_title = parts

  source_page_exists = source_page_id in ALL_PAGE_IDS

  if source_page_exists:
    source_page_id = REDIRECTS.get(source_page_id, source_page_id)

    target_page_id = PAGE_TITLES_TO_IDS.get(target_page_title)

    if target_page_id is not None and source_page_id != target_page_id:
      target_page_id = REDIRECTS.get(target_page_id, target_page_id)
      print('\t'.join([source_page_id, target_page_id]))
if skipped_links:
  print(f'[WARN] {SCRIPT_NAME}: skipped {skipped_links} malformed line(s) in links file',
        file=sys.stderr)
