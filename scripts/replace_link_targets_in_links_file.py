"""
Resolves link target IDs in the trimmed pagelinks file to their corresponding page titles.

Around July 2024, Wikipedia normalized the `pagelinks` table: the target title columns
(`pl_namespace` / `pl_title`) were dropped in favor of a `pl_target_id` column which references a
new `linktarget` table. This script joins the two trimmed files back together, emitting the same
`<source page ID>\t<target page title>` format that the rest of the build pipeline expects (i.e.,
the legacy `links.txt.gz` format consumed by `replace_titles_and_redirects_in_links_file.py`).

Output is written to stdout.
"""

import sys
import gzip

# Ensure stdout round-trips arbitrary page-title bytes safely.
sys.stdout.reconfigure(encoding='utf-8', errors='surrogateescape')

# Validate input arguments.
if len(sys.argv) < 3:
  print('[ERROR] Not enough arguments provided!')
  print('[INFO] Usage: {0} <linktarget_file> <pagelinks_file>'.format(sys.argv[0]))
  sys.exit()

LINKTARGET_FILE = sys.argv[1]
PAGELINKS_FILE = sys.argv[2]

if not LINKTARGET_FILE.endswith('.gz'):
  print('[ERROR] Link target file must be gzipped.')
  sys.exit()

if not PAGELINKS_FILE.endswith('.gz'):
  print('[ERROR] Page links file must be gzipped.')
  sys.exit()

# Create a dictionary mapping link target IDs to their corresponding page titles.
LINK_TARGETS = {}
for line in gzip.open(LINKTARGET_FILE, 'rt', encoding='utf-8', errors='surrogateescape'):
  [target_id, target_title] = line.rstrip('\n').split('\t')
  LINK_TARGETS[target_id] = target_title

# Loop through each link, replacing the link target ID with its title and writing the result (source
# page ID and target page title) to stdout. Links whose target ID does not resolve (e.g., targets
# outside namespace 0) are skipped.
for line in gzip.open(PAGELINKS_FILE, 'rt', encoding='utf-8', errors='surrogateescape'):
  [source_page_id, target_id] = line.rstrip('\n').split('\t')

  target_title = LINK_TARGETS.get(target_id)

  if target_title is not None:
    print('\t'.join([source_page_id, target_title]))
