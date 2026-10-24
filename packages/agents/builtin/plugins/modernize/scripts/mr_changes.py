#!/usr/bin/env python3
"""List the files a merge request changes in the target repository (ADR-0071).

    python3 mr_changes.py --tobe DIR --commit SHA --out FILE

`--tobe` is the read-only checkout of the target repository at the head commit of the merge request. The files are the ones
that differ between that commit and the merge base with the repository's default branch (the branch its mirror's HEAD names),
with the status git gives them (A added, M modified, D deleted, R renamed). The reviewer reads this list to find the code and
the tests of the units. When git cannot tell (no default branch, no common ancestor) the list is empty and says why: the reviewer
then reads the repository as it is. The file is scratch of the run. The exit code is 0, or 2 for input that cannot be used.
Standard library only.
"""
import argparse
import json
import os
import re
import subprocess
import sys

sys.dont_write_bytecode = True
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import docmd  # noqa: E402

COMMIT = re.compile(r'^[0-9a-f]{40}([0-9a-f]{24})?$')
MAX_FILES = 500
GIT = ['git', '-c', 'safe.directory=*', '-c', 'core.quotepath=off']


def git(directory, *args):
    result = subprocess.run([*GIT, '-C', directory, *args], capture_output=True, text=True, timeout=60, check=False)
    return result.returncode, result.stdout


def changes(tobe, commit):
    """{'base', 'head', 'files': [{'status', 'path'}], 'truncated', 'note'}."""
    report = {'base': None, 'head': commit, 'files': [], 'truncated': False, 'note': ''}
    code, common = git(tobe, 'rev-parse', '--git-common-dir')
    if code != 0:
        report['note'] = 'the checkout is not a git worktree'
        return report
    common_dir = os.path.normpath(os.path.join(tobe, common.strip()))
    result = subprocess.run([*GIT, '--git-dir', common_dir, 'symbolic-ref', '--short', 'HEAD'], capture_output=True, text=True, timeout=30, check=False)
    branch = result.stdout.strip() if result.returncode == 0 else ''
    if branch == '':
        report['note'] = 'the default branch of the repository is not known'
        return report
    code, base = git(tobe, 'merge-base', commit, f'refs/heads/{branch}')
    if code != 0 or not COMMIT.match(base.strip()):
        report['note'] = f'no common ancestor with {branch}'
        return report
    report['base'] = base.strip()
    code, listing = git(tobe, 'diff', '--name-status', '--no-renames', base.strip(), commit)
    if code != 0:
        report['note'] = 'git could not compare the commits'
        return report
    files = []
    for line in listing.splitlines():
        status, _, path = line.partition('\t')
        clean = docmd.norm_path(path)
        if status[:1] in 'AMDT' and status != '' and clean is not None:
            files.append({'status': status[:1], 'path': clean})
    report['truncated'] = len(files) > MAX_FILES
    report['files'] = files[:MAX_FILES]
    return report


def main(argv=None):
    parser = argparse.ArgumentParser(description='List the files a merge request changes.')
    parser.add_argument('--tobe', required=True, metavar='DIR', help='the checkout of the target repository at the merge request head')
    parser.add_argument('--commit', required=True, metavar='SHA')
    parser.add_argument('--out', required=True, metavar='FILE')
    args = parser.parse_args(argv)
    if not COMMIT.match(args.commit) or not os.path.isdir(args.tobe):
        print('mr_changes.py: --commit must be a commit id and --tobe an existing directory', file=sys.stderr)
        return 2
    report = changes(os.path.realpath(args.tobe), args.commit)
    docmd.write_text(os.path.abspath(args.out), json.dumps(report, indent=1, ensure_ascii=False))
    print(f'{len(report["files"])} file(s) changed' + (f' ({report["note"]})' if report['note'] else ''))
    return 0


if __name__ == '__main__':
    sys.exit(main())
