#!/usr/bin/env python3
"""Build a bounded, deterministic source inventory and complexity estimate.

Every file record carries the sha256 of its bytes (`sha256`), so the item catalog can tell a changed
item by its digest; a non-source file larger than MAX_FILE_BYTES has no hash.
"""

import argparse
import hashlib
import json
import os
import re
import sys

MAX_FILE_BYTES = 5_000_000
MAX_TOTAL_BYTES = 100_000_000
MAX_FILES = 25_000
MAX_DIRECTORIES = 50_000
MAX_SOURCE_FILES = 10_000
MAX_OUTPUT_BYTES = 8_000_000

# The `.git` file of a linked worktree or submodule checkout points at the repository: not source.
SKIP_FILES = {'.git'}
SKIP_DIRS = {
    '.git', '.hg', '.svn', '.idea', '.vscode', '__pycache__', '.venv', 'venv',
    'node_modules', 'vendor', 'vendors', 'dist', 'build', 'target', 'out',
    'coverage', 'bin', 'obj',
}
LANGUAGES = {
    '.asm': 'Assembly', '.bas': 'BASIC', '.c': 'C', '.cc': 'C++', '.cpp': 'C++',
    '.cbl': 'COBOL', '.cob': 'COBOL', '.cs': 'C#', '.css': 'CSS', '.dart': 'Dart',
    '.go': 'Go', '.h': 'C/C++', '.hpp': 'C++', '.html': 'HTML', '.java': 'Java',
    '.js': 'JavaScript', '.jsx': 'JavaScript', '.kt': 'Kotlin', '.kts': 'Kotlin',
    '.md': 'Markdown', '.mjs': 'JavaScript', '.php': 'PHP', '.pl': 'Perl',
    '.py': 'Python', '.rb': 'Ruby', '.rs': 'Rust', '.scala': 'Scala', '.sh': 'Shell',
    '.sql': 'SQL', '.swift': 'Swift', '.ts': 'TypeScript', '.tsx': 'TypeScript',
    '.vb': 'Visual Basic', '.xml': 'XML', '.yaml': 'YAML', '.yml': 'YAML',
}
C_FAMILY = {'C', 'C++', 'C#', 'C/C++', 'Java', 'JavaScript', 'TypeScript', 'Go', 'Kotlin', 'Swift', 'PHP', 'Dart', 'Scala'}
BRANCHES = {
    'COBOL': ('IF', 'EVALUATE', 'PERFORM'),
    'Python': ('if', 'for', 'while', 'except'),
    'Ruby': ('if', 'unless', 'for', 'while', 'rescue', 'when'),
    'Rust': ('if', 'for', 'while', 'match'),
    'SQL': ('case', 'when'),
}
DEFAULT_BRANCHES = ('if', 'for', 'while', 'case', 'catch')
COMMENT_PREFIXES = ('#', '//', '/*', '*', '*/', '--', '<!--', '-->', '*>')


def branch_pattern(language):
    words = ('if', 'for', 'while', 'case', 'catch') if language in C_FAMILY else BRANCHES.get(language, DEFAULT_BRANCHES)
    return re.compile(r'\b(?:' + '|'.join(re.escape(word) for word in words) + r')\b', re.IGNORECASE)


class DataError(ValueError):
    """Invalid, oversized, or unsafe input data."""


def within(root, path):
    root = os.path.realpath(root)
    real = os.path.realpath(path)
    try:
        return os.path.commonpath((root, real)) == root
    except ValueError:
        return False


def read_source(path):
    return decode_source(read_bounded(path), path)


def read_bounded(path):
    try:
        size = os.path.getsize(path)
        if size > MAX_FILE_BYTES:
            raise DataError(f'source file exceeds the {MAX_FILE_BYTES}-byte limit: {path}')
        with open(path, 'rb') as handle:
            data = handle.read(MAX_FILE_BYTES + 1)
    except OSError as error:
        raise DataError(f'cannot read source file {path}: {error}') from error
    if len(data) > MAX_FILE_BYTES:
        raise DataError(f'source file exceeds the {MAX_FILE_BYTES}-byte limit: {path}')
    return data


def decode_source(data, path):
    if b'\x00' in data:
        raise DataError(f'unexpected binary content in source file: {path}')
    try:
        return data.decode('utf-8-sig')
    except UnicodeDecodeError as error:
        raise DataError(f'source file is not valid UTF-8: {path}') from error


def language_for(path):
    return LANGUAGES.get(os.path.splitext(path)[1].lower(), 'Other')


def analyze(path, text, language):
    lines = text.splitlines()
    blank = 0
    comments = 0
    branches = 0
    pattern = branch_pattern(language)
    for line in lines:
        stripped = line.strip()
        is_comment = stripped.startswith(COMMENT_PREFIXES)
        if language == 'COBOL' and len(line) > 6 and line[6] in ('*', '/'):
            is_comment = True
        if language == 'Visual Basic' and stripped.upper().startswith('REM '):
            is_comment = True
        if not stripped:
            blank += 1
        elif is_comment:
            comments += 1
        else:
            branches += len(pattern.findall(line))
    code_lines = max(0, len(lines) - blank - comments)
    return {
        'path': path,
        'language': language,
        'lines': len(lines),
        'blankLines': blank,
        'commentLines': comments,
        'codeLines': code_lines,
        'sloc': code_lines,
        'cyclomaticComplexity': (1 + branches) if code_lines else 0,
    }



def valid_commit(value):
    if not re.fullmatch(r'[0-9a-fA-F]{40,64}', value):
        raise argparse.ArgumentTypeError('must be a 40-64 character hexadecimal commit')
    return value.lower()

def source_commit(source):
    git_dir = os.path.join(source, '.git')
    if not os.path.isdir(git_dir) or not within(source, git_dir):
        return 'not available'
    try:
        raw = read_source(os.path.join(git_dir, 'HEAD')).decode('ascii').strip()
    except (DataError, UnicodeDecodeError):
        return 'not available'
    if re.fullmatch(r'[0-9a-fA-F]{40,64}', raw):
        return raw.lower()
    if not raw.startswith('ref: '):
        return 'not available'
    ref = raw[5:]
    if not ref or ref.startswith('/') or '..' in ref.split('/'):
        return 'not available'
    path = os.path.join(git_dir, *ref.split('/'))
    if within(source, path) and os.path.isfile(path):
        try:
            value = read_source(path).decode('ascii').strip()
            if re.fullmatch(r'[0-9a-fA-F]{40,64}', value):
                return value.lower()
        except (DataError, UnicodeDecodeError):
            pass
    return 'not available'

def inventory(source, app, source_repository=None, pinned_commit=None):
    if not isinstance(source, str) or not source.strip():
        raise DataError('--source must be a non-empty explicit checkout path')
    root = os.path.realpath(os.path.expanduser(source))
    if not os.path.isdir(root):
        raise DataError(f'--source is not a directory: {source}')
    files = []
    scanned = 0
    visited_directories = 0
    total_bytes = 0

    def walk_error(error):
        raise DataError(f'cannot scan source directory: {error}')

    for current, directories, names in os.walk(root, topdown=True, followlinks=False, onerror=walk_error):
        visited_directories += 1
        if visited_directories > MAX_DIRECTORIES:
            raise DataError(f'source tree exceeds the {MAX_DIRECTORIES}-directory limit')
        kept = []
        for name in sorted(directories):
            path = os.path.join(current, name)
            if name in SKIP_DIRS or os.path.islink(path):
                if os.path.islink(path) and not within(root, path):
                    raise DataError(f'source directory symlink escapes --source: {os.path.relpath(path, root)}')
                continue
            if not within(root, path):
                raise DataError(f'source directory escapes --source: {os.path.relpath(path, root)}')
            kept.append(name)
        directories[:] = kept
        for name in sorted(names):
            path = os.path.join(current, name)
            if name in SKIP_FILES:
                continue
            if os.path.islink(path):
                if not within(root, path):
                    raise DataError(f'source file symlink escapes --source: {os.path.relpath(path, root)}')
                continue
            if not os.path.isfile(path) or not within(root, path):
                raise DataError(f'unsafe source path: {path}')
            scanned += 1
            if scanned > MAX_FILES:
                raise DataError(f'source tree exceeds the {MAX_FILES}-file limit')
            size = os.path.getsize(path)
            total_bytes += size
            if total_bytes > MAX_TOTAL_BYTES:
                raise DataError(f'source tree exceeds the {MAX_TOTAL_BYTES}-byte scanned-data limit')
            rel = os.path.relpath(path, root).replace(os.sep, '/')
            language = language_for(rel)
            record = {'path': rel, 'bytes': size, 'language': language}
            if language != 'Other':
                data = read_bounded(path)
                record = analyze(rel, decode_source(data, path), language) | {'bytes': size, 'sha256': hashlib.sha256(data).hexdigest()}
                files.append(record)
                if len(files) > MAX_SOURCE_FILES:
                    raise DataError(f'source tree exceeds the {MAX_SOURCE_FILES}-source-file limit')
            else:
                if size <= MAX_FILE_BYTES:
                    record['sha256'] = hashlib.sha256(read_bounded(path)).hexdigest()
                files.append(record)

    source_files = [item for item in files if item['language'] != 'Other']
    language_counts = {}
    per_language = {}
    total_lines = code_lines = complexity = 0
    for item in source_files:
        lang = item['language']
        language_counts[lang] = language_counts.get(lang, 0) + 1
        metrics = per_language.setdefault(lang, {'files': 0, 'lines': 0, 'codeLines': 0, 'complexity': 0})
        metrics['files'] += 1
        metrics['lines'] += item['lines']
        metrics['codeLines'] += item['codeLines']
        metrics['sloc'] = metrics['codeLines']
        metrics['complexity'] += item['cyclomaticComplexity']
        total_lines += int(item['lines'])
        code_lines += int(item['codeLines'])
        complexity += int(item['cyclomaticComplexity'])
    ksloc = round(code_lines / 1000, 3)
    complexity_index = round(2.94 * (ksloc ** 1.10), 2) if ksloc else 0.0
    ranked = sorted(source_files, key=lambda item: (-item['cyclomaticComplexity'], item['path']))
    for metrics in per_language.values():
        metrics['ksloc'] = round(metrics['codeLines'] / 1000, 3)
    return {
        'app': app,
        'sourceRepository': source_repository or os.path.basename(os.path.normpath(source)),
        'sourceCommit': pinned_commit or source_commit(root),
        'method': 'static UTF-8 inventory; per-file decision keywords are counted as a language-neutral complexity proxy',
        'complexityIndexFormula': '2.94 × KSLOC^1.10',
        'fileCount': len(files),
        'sourceFileCount': len(source_files),
        'totalBytes': sum(item['bytes'] for item in files),
        'totalLines': total_lines,
        'codeLines': code_lines,
        'sloc': code_lines,
        'ksloc': ksloc,
        'languages': {key: language_counts[key] for key in sorted(language_counts)},
        'languageMetrics': {key: per_language[key] for key in sorted(per_language)},
        'complexity': complexity,
        'complexityPerKsloc': round(complexity / ksloc, 2) if ksloc else None,
        'complexityIndex': complexity_index,
        'mostComplexFiles': [
            {'path': item['path'], 'cyclomaticComplexity': item['cyclomaticComplexity']}
            for item in ranked[:25]
        ],
        'files': sorted(files, key=lambda item: item['path']),
    }


def write_json(out, data, source_root):
    if within(source_root, out):
        raise DataError('--out must be outside the read-only --source checkout')
    if os.path.islink(out):
        raise DataError(f'refusing to write through a symbolic link: {out}')
    os.makedirs(out, exist_ok=True)
    root = os.path.realpath(out)
    path = os.path.join(root, 'inventory.json')
    temporary = path + '.tmp'
    if not within(root, path) or os.path.islink(path) or os.path.islink(temporary):
        raise DataError(f'refusing to write outside --out or through a symbolic link: {path}')
    encoded = json.dumps(data, ensure_ascii=False, indent=2) + '\n'
    if len(encoded.encode('utf-8')) > MAX_OUTPUT_BYTES:
        raise DataError(f'inventory output exceeds the {MAX_OUTPUT_BYTES}-byte limit')
    with open(temporary, 'w', encoding='utf-8', newline='\n') as handle:
        handle.write(encoded)
    os.replace(temporary, path)
    return path


def main(argv=None):
    parser = argparse.ArgumentParser(description='Build a bounded source inventory and static complexity estimate.')
    parser.add_argument('app', help='application id used in the inventory heading')
    parser.add_argument('--source-commit', type=valid_commit, help='pinned source commit (40-64 hexadecimal characters)')
    parser.add_argument('--source-repo', help='source repository identity label')
    parser.add_argument('--source', required=True, help='read-only source checkout')
    parser.add_argument('--out', required=True, help='folder where inventory.json is written')
    args = parser.parse_args(argv[1:] if argv is not None else None)
    try:
        if not args.out.strip():
            raise DataError('--out must be a non-empty explicit output folder')
        data = inventory(args.source, args.app, args.source_repo, args.source_commit)
        source_root = os.path.realpath(os.path.expanduser(args.source))
        path = write_json(os.path.abspath(os.path.expanduser(args.out)), data, source_root)
    except (DataError, OSError, RecursionError) as error:
        print(f'inventory.py: {error}', file=sys.stderr)
        return 1
    print(f'inventory.json: {data["sourceFileCount"]} source files, {data["codeLines"]} code lines -> {path}')
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))
