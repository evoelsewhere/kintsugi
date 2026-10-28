"""Source citations (ADR-0085): the `<repository id>/<path>:line[-line]` citations of a document, checked against the
legacy repositories the run read.

One parser and one check for `finish_items.py` (the understanding record lists the citations that do not resolve) and
the known-answer eval (`packages/agents/evals/known-answer/score.py`). A citation resolves when it names a file of one
of the repositories and lines that file has; a leading `as-is/` is dropped and a path without its repository id
resolves when exactly one repository has it, as `catalog_common.Owners` resolves them. A path that names a document of
the document repository (a Markdown file, or under one of its root folders) is not a source citation and is skipped.
The check reports, it never edits a document. Standard library only.
"""
import os
import re

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

    def check(self, text):
        """(the number of source citations, [(citation, why)] of those that do not hold) of a text; each citation once."""
        checked, problems = 0, []
        for citation in dict.fromkeys(citations_in(text)):
            source, why = self.problem(citation)
            checked += source
            if why:
                problems.append((label(citation), why))
        return checked, problems
