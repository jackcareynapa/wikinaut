#!/usr/bin/env python3
"""Build wikinaut.user.js from the fragments under src/.

The userscript is a single IIFE sharing one lexical scope, so the "modules" in src/ are
plain text fragments, not ES modules: no import/export, no bundler, no node toolchain.
This script concatenates them in the order given by src/manifest.txt, wraps the result in
the IIFE, and prepends src/header.js (the ==UserScript== metadata block, which must stay
outside the IIFE for the userscript manager to read it).

Usage:
  python scripts/build_userscript.py                # write wikinaut.user.js
  python scripts/build_userscript.py --check        # verify it is up to date, else exit 1
  python scripts/build_userscript.py --output PATH  # build somewhere else
"""

import argparse
import difflib
import sys

from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
SRC_DIR = REPO_ROOT / 'src'
MANIFEST = SRC_DIR / 'manifest.txt'
HEADER = SRC_DIR / 'header.js'
DEFAULT_OUTPUT = REPO_ROOT / 'wikinaut.user.js'

IIFE_OPEN = '(function wikinautUserscript() {'
IIFE_CLOSE = '})();'


def read_manifest():
    """Fragment paths from src/manifest.txt, in build order. Blank/# lines are ignored."""
    if not MANIFEST.is_file():
        raise SystemExit('missing manifest: {}'.format(MANIFEST))

    paths = []
    for lineno, raw in enumerate(MANIFEST.read_text(encoding='utf-8').splitlines(), 1):
        entry = raw.strip()
        if not entry or entry.startswith('#'):
            continue
        path = SRC_DIR / entry
        if not path.is_file():
            raise SystemExit(
                'manifest.txt line {}: no such fragment: {}'.format(lineno, path))
        paths.append(path)

    if not paths:
        raise SystemExit('manifest.txt lists no fragments')
    return paths


def read_fragment(path):
    """A fragment's lines with leading/trailing blank lines trimmed.

    Fragments keep the two-space indentation they carry inside the IIFE; trimming only the
    outer blank lines lets the join below put exactly one blank line between sections.
    """
    lines = path.read_text(encoding='utf-8').splitlines()
    while lines and not lines[0].strip():
        lines.pop(0)
    while lines and not lines[-1].strip():
        lines.pop()
    if not lines:
        raise SystemExit('empty fragment: {}'.format(path))
    return '\n'.join(lines)


def build():
    """The full userscript text."""
    if not HEADER.is_file():
        raise SystemExit('missing header: {}'.format(HEADER))

    header = read_fragment(HEADER)
    body = '\n\n'.join(read_fragment(path) for path in read_manifest())
    return '{}\n\n{}\n{}\n{}\n'.format(header, IIFE_OPEN, body, IIFE_CLOSE)


def check(built, output):
    """Exit 1 with a diff if `output` is not what the sources build to."""
    if not output.is_file():
        raise SystemExit('{} does not exist; run scripts/build_userscript.py'.format(output))

    current = output.read_text(encoding='utf-8')
    if current == built:
        print('{} is up to date.'.format(output.name))
        return 0

    diff = difflib.unified_diff(
        current.splitlines(keepends=True), built.splitlines(keepends=True),
        fromfile='{} (committed)'.format(output.name), tofile='{} (from src/)'.format(output.name))
    sys.stdout.writelines(diff)
    print(
        '\n{} is out of date. Edit the sources in src/, then run '
        'scripts/build_userscript.py.'.format(output.name),
        file=sys.stderr)
    return 1


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument(
        '--check', action='store_true',
        help='verify the built file matches src/ instead of writing it')
    parser.add_argument(
        '--output', type=Path, default=DEFAULT_OUTPUT,
        help='where to write the built userscript (default: {})'.format(DEFAULT_OUTPUT.name))
    args = parser.parse_args()

    built = build()
    if args.check:
        return check(built, args.output)

    args.output.write_text(built, encoding='utf-8')
    print('Wrote {} ({:,} lines).'.format(args.output, built.count('\n')))
    return 0


if __name__ == '__main__':
    sys.exit(main())
