"""
Fixture-based smoke tests for the graph-build pipeline scripts (scripts/*.py).

These exercise the malformed-line guards (S1 in the hardening plan): a bad Wikipedia dump row
must be skipped with a [WARN] on stderr (naming the script and a count), not crash the whole
pipeline stage. Each test also checks that well-formed rows still produce the expected output, so
the guard doesn't silently swallow good data.

Not a full pipeline test — that needs a real dump (see docs/data-source.md) — just tiny synthetic
fixtures per stage.
"""

import gzip
import os
import subprocess
import sys

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SCRIPTS_DIR = os.path.join(REPO_ROOT, 'scripts')


def write_gz(path, lines):
  with gzip.open(path, 'wt', encoding='utf-8') as f:
    for line in lines:
      f.write(line + '\n')


def run_script(name, *args):
  return subprocess.run(
      [sys.executable, os.path.join(SCRIPTS_DIR, name), *args],
      capture_output=True, text=True, check=False)


def test_combine_grouped_links_files_skips_malformed_lines(tmp_path):
  outgoing = tmp_path / 'outgoing.txt.gz'
  incoming = tmp_path / 'incoming.txt.gz'
  write_gz(outgoing, ['1\t2|3', 'malformed-line-no-tab', '4\t5'])
  write_gz(incoming, ['2\t1', '3\t1'])

  result = run_script('combine_grouped_links_files.py', str(outgoing), str(incoming))

  assert result.returncode == 0
  assert 'combine_grouped_links_files: skipped 1 malformed line(s)' in result.stderr
  assert '1\t2\t0\t2|3\t' in result.stdout
  assert '4\t1\t0\t5\t' in result.stdout


def test_replace_link_targets_skips_malformed_lines(tmp_path):
  linktarget = tmp_path / 'linktarget.sql.gz'
  pagelinks = tmp_path / 'pagelinks.sql.gz'
  write_gz(linktarget, ['100\tSome_Page', 'malformed'])
  write_gz(pagelinks, ['1\t100', 'bad-row-here'])

  result = run_script('replace_link_targets_in_links_file.py', str(linktarget), str(pagelinks))

  assert result.returncode == 0
  assert 'replace_link_targets_in_links_file: skipped 1 malformed line(s) in linktarget file' \
      in result.stderr
  assert 'replace_link_targets_in_links_file: skipped 1 malformed line(s) in pagelinks file' \
      in result.stderr
  assert result.stdout.strip() == '1\tSome_Page'


def test_replace_titles_and_redirects_skips_malformed_lines(tmp_path):
  pages = tmp_path / 'pages.sql.gz'
  redirects = tmp_path / 'redirects.sql.gz'
  links = tmp_path / 'links.txt.gz'
  write_gz(pages, ['1\tPage_One\t0', '2\tPage_Two\t0', 'bad\trow'])
  write_gz(redirects, ['bad-redirect-row'])
  write_gz(links, ['1\tPage_Two', 'malformed-link-row'])

  result = run_script(
      'replace_titles_and_redirects_in_links_file.py', str(pages), str(redirects), str(links))

  assert result.returncode == 0
  assert 'replace_titles_and_redirects_in_links_file: malformed pages row' in result.stderr
  assert 'replace_titles_and_redirects_in_links_file: skipped 1 malformed line(s) in redirects file' \
      in result.stderr
  assert 'replace_titles_and_redirects_in_links_file: skipped 1 malformed line(s) in links file' \
      in result.stderr
  assert result.stdout.strip() == '1\t2'


def test_replace_titles_in_redirects_skips_malformed_lines(tmp_path):
  pages = tmp_path / 'pages.sql.gz'
  redirects = tmp_path / 'redirects.sql.gz'
  write_gz(pages, ['1\tPage_One\t1', '2\tPage_Two\t0', 'bad\trow'])
  write_gz(redirects, ['1\tPage_Two', 'malformed-redirect-row'])

  result = run_script('replace_titles_in_redirects_file.py', str(pages), str(redirects))

  assert result.returncode == 0
  assert 'replace_titles_in_redirects_file: malformed pages row' in result.stderr
  assert 'replace_titles_in_redirects_file: skipped 1 malformed line(s) in redirects file' \
      in result.stderr
  assert result.stdout.strip() == '1\t2'


def test_prune_pages_file_skips_malformed_lines(tmp_path):
  pages = tmp_path / 'pages.sql.gz'
  redirects = tmp_path / 'redirects.sql.gz'
  write_gz(pages, ['1\tPage_One\t0', '2\tPage_Two\t1', '3\tPage_Three\t1', 'bad\trow'])
  write_gz(redirects, ['2\t1', 'malformed-redirect-row'])

  result = run_script('prune_pages_file.py', str(pages), str(redirects))

  assert result.returncode == 0
  assert 'prune_pages_file: skipped 1 malformed line(s) in redirects file' in result.stderr
  assert 'prune_pages_file: malformed pages row' in result.stderr
  # Page 1 (non-redirect) and page 2 (redirect WITH a redirects-table row) survive; page 3
  # (redirect flag but no redirects-table row) is pruned.
  lines = result.stdout.strip().split('\n')
  assert '1\tPage_One\t0' in lines
  assert '2\tPage_Two\t1' in lines
  assert not any('Page_Three' in line for line in lines)
