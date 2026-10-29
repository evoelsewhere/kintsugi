"""Source citations (ADR-0085): the `<repository id>/<path>:line[-line]` citations of a document, checked against the
legacy repositories the run read.

One parser and one check for `finish_items.py` (the understanding record lists the citations that do not resolve) and
the known-answer eval (`packages/agents/evals/known-answer/score.py`). A citation resolves when it names a file of one
of the repositories and lines that file has; a leading `as-is/` is dropped and a path without its repository id
resolves when exactly one repository has it, as `catalog_common.Owners` resolves them. A path that names a document of
the document repository (a Markdown file, or under one of its root folders) is not a source citation and is skipped.
The check reports, it never edits a document.

`ReadRecord` reads what the job that wrote a document was shown of the source (ADR-0086), so that a citation of a line
the job never saw can be told apart from one it read. `Sources.cited_lines` and `Sources.moved` keep a digest of the
lines each citation names and tell, when the source has moved on, which of them changed (ADR-0087). Standard library only.
"""
import hashlib
import os
import re

import docmd

# `<path with an extension>:<line>[-<line>]`; a bare word before the colon is not a citation.
CITATION = re.compile(r'(?<![\w./-])(?P<path>(?:[\w.-]+/)*[\w.-]+\.(?P<ext>[A-Za-z0-9]{1,8})):(?P<start>\d+)(?:\s*[-–]\s*(?P<end>\d+))?')
ZONE = 'as-is'
DOCUMENT_EXTENSIONS = ('md', 'mmd')
DOCUMENT_ROOTS = ('00-project', '01-standards', '02-architecture', '03-transition', '10-applications', 'plugins', 'scratch', '_catalog', '_generated', '_tools')


def citations_in(text):
    """[(cited path, first line, last line)] of the citations of a text, in order; a range written backwards is turned round."""
    found = []
    for match in CITATION.finditer(text or ''):
        start = int(match.group('start'))
        end = int(match.group('end') or start)
        found.append((match.group('path'), min(start, end), max(start, end)))
    return found


def label(citation):
    path, start, end = citation
    return f'{path}:{start}' if start == end else f'{path}:{start}-{end}'


def _parts(cited):
    parts = [part for part in cited.replace('\\', '/').split('/') if part and part != '.']
    return parts[1:] if parts[:1] == [ZONE] else parts


def is_document(cited):
    """Whether a cited path names a document of the document repository rather than legacy source."""
    parts = _parts(cited)
    return bool(parts) and (parts[-1].rsplit('.', 1)[-1].lower() in DOCUMENT_EXTENSIONS or parts[0] in DOCUMENT_ROOTS)


def _line_count(path):
    count, last = 0, b''
    with open(path, 'rb') as handle:
        for block in iter(lambda: handle.read(1 << 16), b''):
            count += block.count(b'\n')
            last = block
    return count + (1 if last and not last.endswith(b'\n') else 0)


class Sources:
    """The legacy repositories a run read, {repository id: checkout folder}; each file's length is read once."""

    def __init__(self, roots):
        self.roots = {repo: os.path.realpath(folder) for repo, folder in roots.items()}
        self._lengths = {}

    def _file(self, repo, rel):
        root = self.roots[repo]
        path = os.path.realpath(os.path.join(root, *rel.split('/')))
        return path if path.startswith(root + os.sep) and os.path.isfile(path) else None

    def resolve(self, cited):
        """((repository id, path inside it), None) of the file a cited path names, or (None, why it does not resolve)."""
        parts = _parts(cited)
        if not parts or '..' in parts:
            return None, 'not a path inside a repository'
        if parts[0] in self.roots and len(parts) > 1:
            rel = '/'.join(parts[1:])
            return ((parts[0], rel), None) if self._file(parts[0], rel) else (None, f'no such file in {parts[0]}')
        rel = '/'.join(parts)
        hits = [repo for repo in self.roots if self._file(repo, rel)]
        if len(hits) == 1:
            return (hits[0], rel), None
        if hits:
            return None, f'in several repositories ({", ".join(sorted(hits))}): name one'
        return None, 'no such file in the sources'

    def lines(self, repo, rel):
        key = (repo, rel)
        if key not in self._lengths:
            self._lengths[key] = _line_count(self._file(repo, rel))
        return self._lengths[key]

    def problem(self, citation):
        """(is it a source citation, why it does not hold or None). A cited document is not a source citation."""
        cited, start, end = citation
        found, why = self.resolve(cited)
        if found is None:
            return (False, None) if is_document(cited) else (True, why)
        if start < 1:
            return True, 'no line number'
        length = self.lines(*found)
        if end > length:
            return True, f'line {end} is past the end of the file ({length} lines)'
        return True, None

    def digest(self, repo, rel, start, end):
        """The sha256 (first 16 hex digits) of lines `start`-`end` of `<repo>/<rel>`, line endings ignored; None when the
        file or the lines are not there (ADR-0087)."""
        path = self._file(repo, rel) if repo in self.roots else None
        if path is None or start < 1:
            return None
        with open(path, 'rb') as handle:
            lines = handle.read().split(b'\n')
        if lines and lines[-1] == b'':
            lines.pop()
        if end > len(lines):
            return None
        return hashlib.sha256(b'\n'.join(line.rstrip(b'\r') for line in lines[start - 1:end])).hexdigest()[:16]

    def cited_lines(self, text):
        """{citation: digest} of the source citations of a text that hold, in the form `<repo>/<path>:<start>-<end>`."""
        found = {}
        for citation in citations_in(text):
            source, why = self.problem(citation)
            if not source or why:
                continue
            (repo, rel), _ = self.resolve(citation[0])
            found[f'{repo}/{rel}:{citation[1]}-{citation[2]}'] = self.digest(repo, rel, citation[1], citation[2])
        return found

    def moved(self, recorded):
        """[(citation, why)] of the recorded `{citation: digest}` whose lines are no longer what they were (ADR-0087)."""
        out = []
        for cited, digest in sorted(recorded.items()):
            parsed = citations_in(cited)
            if not parsed:
                continue
            found, why = self.resolve(parsed[0][0])
            if found is None:
                out.append((cited, why))
                continue
            now = self.digest(*found, parsed[0][1], parsed[0][2])
            if now is None:
                out.append((cited, f'line {parsed[0][2]} is past the end of the file now'))
            elif now != digest:
                out.append((cited, 'the lines changed'))
        return out

    def unshown(self, text, record, inherited=''):
        """The valid source citations of `text` whose lines `record` does not show in one read, leaving out those a
        citation of `inherited` covers (the rules and findings the job was given: copied from a checked document)."""
        given = []
        for path, start, end in citations_in(inherited):
            found, _ = self.resolve(path)
            if found is not None:
                given.append((found, start, end))
        out = []
        for citation in dict.fromkeys(citations_in(text)):
            source, why = self.problem(citation)
            if not source or why:
                continue
            found, _ = self.resolve(citation[0])
            if record.shown(*found, citation[1], citation[2]):
                continue
            if any(other == found and start <= citation[1] and end >= citation[2] for other, start, end in given):
                continue
            out.append(label(citation))
        return out

    def check(self, text):
        """(the number of source citations, [(citation, why)] of those that do not hold) of a text; each citation once."""
        checked, problems = 0, []
        for citation in dict.fromkeys(citations_in(text)):
            source, why = self.problem(citation)
            checked += source
            if why:
                problems.append((label(citation), why))
        return checked, problems


class ReadRecord:
    """What the job that wrote a document was shown of the source (ADR-0086): the JSON the orchestrator saves for an agent
    step with `readsTo`, `{agent, complete, unrecorded, files: {<repository id>/<path>: [[from, to or null], ...]}}`.
    `complete` is false when the job also used a tool that reads without telling which lines (`shell`, `git`)."""

    def __init__(self, data):
        files = data.get('files') if isinstance(data, dict) else None
        self.files = {}
        for path, ranges in (files or {}).items():
            kept = [(int(r[0]), None if r[1] is None else int(r[1])) for r in ranges if isinstance(r, list) and len(r) == 2 and isinstance(r[0], int)]
            self.files[str(path)] = kept
        self.complete = bool(data.get('complete')) if isinstance(data, dict) else False
        self.unrecorded = data.get('unrecorded') if isinstance(data, dict) and isinstance(data.get('unrecorded'), dict) else {}

    def shown(self, repo, rel, start, end):
        """Whether every line from `start` to `end` of `<repo>/<rel>` was shown in one read."""
        return any(first <= start and (last is None or last >= end) for first, last in self.files.get(f'{repo}/{rel}', []))

    def lines_shown(self, repo, rel, length):
        """How many of the `length` lines of `<repo>/<rel>` were shown."""
        return sum(max(0, min(length, length if last is None else last) - first + 1) for first, last in self.files.get(f'{repo}/{rel}', []))


CITED_LINES_SECTION = 'Cited lines'


def cited_lines_section(cited):
    """The section of an understanding record that keeps the digest of every line range its unit's documents cite."""
    rows = ''.join(f'| `{citation}` | {digest} |\n' for citation, digest in sorted(cited.items()))
    return (f'\n## {CITED_LINES_SECTION}\n\nThe digest of each range of source lines the unit\'s documents cite, when they were written. '
            'When the source moves on, a range whose digest changed points at the statements to check again.\n\n'
            '| Citation | Digest |\n| --- | --- |\n' + rows)


def recorded_cited_lines(text):
    """{citation: digest} of an understanding record's `Cited lines` section; empty for a record without one."""
    body = next((body for title, body in docmd.sections(docmd.split_front_matter(text or '')[1], 2) if title.strip() == CITED_LINES_SECTION), '')
    return {docmd.uncode(row.get('citation', '')).strip(): row.get('digest', '').strip() for row in docmd.records_in(body) if row.get('citation')}
