#!/usr/bin/env python3
"""Generate `languages.py` of the reverse_engineering plugin from the Pygments lexer catalogue.

    python scripts/gen_languages.py [--check] [--linguist languages.yml]

`inventory.py` names the language of a file by its extension or its file name. The table it uses is generated here: Pygments knows
the extensions and the file names of about 600 languages, and this script keeps the programming, scripting, query, hardware and
template languages, drops data, configuration, log and documentation formats, adds what GitHub Linguist knows beyond that (its
`programming` languages, pinned to LINGUIST_COMMIT), and applies the curated choices below for the extensions several languages claim.
The result is committed (`languages.py` is standard library only, the plugin does not need Pygments or PyYAML); run this script
again after a Pygments upgrade, a new Linguist commit or a change to the curated part, and review the diff.

--check exits 1 when the committed file differs from what would be generated.
"""
import argparse
import os
import re
import sys
import urllib.request
from collections import defaultdict

try:
    import pygments
    import yaml
    from pygments.lexers._mapping import LEXERS
except ImportError:
    sys.exit('gen_languages.py needs Pygments and PyYAML (pip install pygments pyyaml)')

# GitHub Linguist is the second source: its programming languages add the extensions and file names Pygments does not know. Pinned,
# so that a run is reproducible; change the commit, run the script again and review the diff to take a newer catalogue.
LINGUIST_COMMIT = '73ee9a3b277f398c37ca4ab0dea0193849de6460'
LINGUIST_URL = f'https://raw.githubusercontent.com/github-linguist/linguist/{LINGUIST_COMMIT}/lib/linguist/languages.yml'

OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'packages', 'agents', 'builtin', 'plugins', 'reverse_engineering', 'scripts', 'languages.py')

# Pygments modules of formats that are not source code: data, configuration, logs, protocol text, documentation and the like.
EXCLUDED_MODULES = {
    'asc', 'bibtex', 'configs', 'console', 'data', 'devicetree', 'diff', 'dns', 'email', 'hexdump', 'installers', 'json5', 'jsonnet',
    'ldap', 'markup', 'mime', 'procfile', 'rdf', 'resource', 'sgf', 'special', 'srcinfo', 'textfmts', 'usd', 'wowtoc', 'xorg',
    'archetype', 'cddl', 'asn1', 'grammar_notation', 'graphviz', 'gcodelexer', 'minecraft', 'lilypond', 'tnt', 'urbi', 'teraterm',
}
# A lexer for a session, a log or a dialect of a language that has its own lexer.
EXCLUDED_NAME_PARTS = ('session', 'console', 'traceback', 'EXPLAIN', 'objdump', 'Hexdump', 'Text only', 'sqlite3con')

# The languages the inventory has always named, with the names it has always used: they win over Pygments.
CURATED = {
    '.asm': 'Assembly', '.bas': 'BASIC', '.c': 'C', '.cc': 'C++', '.cpp': 'C++', '.cbl': 'COBOL', '.cob': 'COBOL', '.cs': 'C#',
    '.css': 'CSS', '.dart': 'Dart', '.go': 'Go', '.h': 'C/C++', '.hpp': 'C++', '.html': 'HTML', '.java': 'Java', '.js': 'JavaScript',
    '.jsx': 'JavaScript', '.kt': 'Kotlin', '.kts': 'Kotlin', '.md': 'Markdown', '.mjs': 'JavaScript', '.php': 'PHP', '.pl': 'Perl',
    '.py': 'Python', '.rb': 'Ruby', '.rs': 'Rust', '.scala': 'Scala', '.sh': 'Shell', '.sql': 'SQL', '.swift': 'Swift',
    '.ts': 'TypeScript', '.tsx': 'TypeScript', '.vb': 'Visual Basic', '.xml': 'XML', '.yaml': 'YAML', '.yml': 'YAML',
    # Visual Basic 6: classes, forms, user controls and designers.
    '.cls': 'Visual Basic', '.frm': 'Visual Basic', '.ctl': 'Visual Basic', '.dsr': 'Visual Basic',
    # Web front ends: single-file components, other script and style flavours, server pages.
    '.vue': 'Vue', '.svelte': 'Svelte', '.astro': 'Astro', '.cjs': 'JavaScript', '.mts': 'TypeScript', '.cts': 'TypeScript',
    '.scss': 'CSS', '.sass': 'CSS', '.less': 'CSS', '.htm': 'HTML', '.xhtml': 'HTML', '.jsp': 'JSP', '.jspf': 'JSP', '.tag': 'JSP',
    # JVM build scripts and the rest of what legacy systems commonly hold.
    '.groovy': 'Groovy', '.gradle': 'Groovy', '.ps1': 'PowerShell', '.psm1': 'PowerShell', '.bat': 'Batch', '.cmd': 'Batch',
    '.pls': 'PL/SQL', '.pks': 'PL/SQL', '.pkb': 'PL/SQL', '.plsql': 'PL/SQL',
    # Several languages claim these: the one a legacy system most likely means.
    '.m': 'Objective-C', '.mm': 'Objective-C++', '.v': 'Verilog', '.r': 'R', '.t': 'Perl', '.pro': 'Prolog', '.inc': 'PHP',
    '.d': 'D', '.fs': 'F#', '.ml': 'OCaml', '.re': 'ReasonML', '.sc': 'Scala', '.cl': 'Common Lisp', '.el': 'Emacs Lisp',
    '.st': 'Smalltalk', '.ex': 'Elixir', '.exs': 'Elixir', '.erl': 'Erlang', '.hrl': 'Erlang', '.lua': 'Lua', '.tcl': 'Tcl',
    '.jl': 'Julia', '.hs': 'Haskell', '.clj': 'Clojure', '.lisp': 'Common Lisp', '.scm': 'Scheme', '.rkt': 'Racket', '.pas': 'Pascal',
    '.pp': 'Pascal', '.dpr': 'Pascal', '.f': 'Fortran', '.for': 'Fortran', '.f90': 'Fortran', '.f95': 'Fortran', '.adb': 'Ada',
    '.ads': 'Ada', '.mod': 'Modula-2', '.rpg': 'RPG', '.abap': 'ABAP', '.jcl': 'JCL', '.cpy': 'COBOL',
    '.s': 'Assembly', '.sv': 'SystemVerilog', '.vhd': 'VHDL', '.vhdl': 'VHDL', '.tf': 'Terraform', '.proto': 'Protocol Buffers',
    '.thrift': 'Thrift', '.graphql': 'GraphQL', '.gql': 'GraphQL', '.sol': 'Solidity', '.zig': 'Zig', '.nim': 'Nim', '.cr': 'Crystal',
    '.coffee': 'CoffeeScript', '.ejs': 'EJS', '.erb': 'ERB', '.jinja': 'Jinja', '.j2': 'Jinja', '.twig': 'Twig',
    '.hbs': 'Handlebars', '.mustache': 'Mustache', '.aspx': 'ASP.NET', '.ascx': 'ASP.NET', '.asax': 'ASP.NET', '.cshtml': 'Razor',
    '.vbhtml': 'Razor', '.razor': 'Razor', '.asp': 'ASP', '.vbs': 'VBScript', '.wsf': 'VBScript', '.fmb': 'Oracle Forms',
    # The rest of the extensions Pygments says several languages claim, decided.
    '.as': 'ActionScript', '.ashx': 'ASP.NET', '.asmx': 'ASP.NET', '.axd': 'ASP.NET', '.cp': 'C++', '.ecl': 'ECL', '.feature': 'Gherkin',
    '.gd': 'GDScript', '.hh': 'C++', '.lean': 'Lean', '.pm': 'Perl', '.prolog': 'Prolog', '.scd': 'SuperCollider', '.xsl': 'XSLT',
    '.xslt': 'XSLT',
    # Mainframe, midrange, 4GL and client-server systems: the languages an old estate is written in.
    '.rpgle': 'RPG', '.sqlrpgle': 'RPG', '.rpgle4': 'RPG', '.pli': 'PL/I', '.pl1': 'PL/I', '.bms': 'COBOL', '.cpb': 'COBOL',
    '.rexx': 'Rexx', '.rex': 'Rexx', '.pc': 'C', '.pcc': 'C++', '.dfm': 'Delphi', '.xaml': 'XAML', '.4gl': 'Informix 4GL',
    '.srw': 'PowerBuilder', '.sru': 'PowerBuilder', '.srf': 'PowerBuilder', '.srd': 'PowerBuilder', '.ddl': 'SQL', '.tsql': 'SQL',
    '.prc': 'SQL', '.fnc': 'PL/SQL', '.trg': 'PL/SQL', '.ftl': 'FreeMarker', '.cfm': 'ColdFusion', '.cfc': 'ColdFusion',
    '.natural': 'Natural', '.nsp': 'Natural', '.ngl': 'Natural', '.clp': 'CL', '.clle': 'CL', '.mak': 'Makefile', '.mk': 'Makefile',
    # z/OS: DCLGEN output (a COBOL host structure), JCL procedures, assembler macros, and IMS database and program definitions (assembler macros).
    '.dcl': 'COBOL', '.proc': 'JCL', '.mac': 'Assembly', '.dbd': 'Assembly', '.psb': 'Assembly',
    # More mainframe source: JCL job and control members, Pro*COBOL and embedded-SQL COBOL, high level assembler, Easytrieve.
    '.cntl': 'JCL', '.job': 'JCL', '.pco': 'COBOL', '.sqb': 'COBOL', '.cb2': 'COBOL', '.mlc': 'Assembly', '.hlasm': 'Assembly',
    '.ezt': 'Easytrieve',
    # Extensions Linguist says several languages claim, decided: Progress OpenEdge, Fortran preprocessing, M4, VBA, Salesforce, Cake.
    '.w': 'OpenEdge ABL', '.fpp': 'Fortran', '.m4': 'M4', '.vba': 'Visual Basic', '.trigger': 'Apex', '.cake': 'C#',
}
# Pygments names that differ in case or spelling from the name people use.
CANONICAL = {
    'systemverilog': 'SystemVerilog', 'autohotkey': 'AutoHotkey', 'liquid': 'Liquid', 'teal': 'Teal', 'Nimrod': 'Nim',
    'Perl6': 'Raku', 'nesC': 'nesC', 'xtlang': 'xtlang', 'ucode': 'ucode', 'execline': 'execline', 'cplint': 'cplint', 'dg': 'dg',
    'eC': 'eC', 'Coldfusion HTML': 'ColdFusion', 'Coldfusion CFC': 'ColdFusion', 'Hxml': 'Haxe', 'MXML': 'ActionScript',
    'ActionScript 3': 'ActionScript', 'Literate Haskell': 'Haskell', 'Literate Agda': 'Agda', 'Literate Cryptol': 'Cryptol',
    'Literate Idris': 'Idris', 'Lean4': 'Lean', 'FortranFixed': 'Fortran', 'COBOLFree': 'COBOL', 'VB.net': 'Visual Basic',
    'Objective-J': 'Objective-J', 'Tcsh': 'Shell', 'Bash': 'Shell', 'Fish': 'Shell', 'Batchfile': 'Batch',
}
# Several languages claim these and none is the likely meaning: left out, the file is read as "Other".
AMBIGUOUS_TO_OTHER = {
    '.txt', '.text', '.in', '.out', '.log', '.def', '.dat', '.bin', '.lst', '.tmp', '.conf', '.cfg', '.ini', '.json',
    '.b', '.bug', '.g', '.i', '.j', '.mac', '.mi', '.n', '.p', '.rl',
    # A mainframe PS data set (Physical Sequential), not PostScript; a CICS CSD resource definition, not a Csound score.
    '.ps', '.csd',
}
# Linguist names that are the same language as a name above (compared without case): the one the inventory already uses wins.
LINGUIST_ALIASES = {
    'PLSQL': 'PL/SQL', 'Batchfile': 'Batch', 'Fortran Free Form': 'Fortran', 'MATLAB': 'Matlab', 'Wolfram Language': 'Mathematica',
    'REXX': 'Rexx', 'xBase': 'FoxPro', 'SQLPL': 'SQL', 'PLpgSQL': 'PL/SQL', 'JavaScript+ERB': 'JavaScript', 'NetLinx+ERB': 'NetLinx',
    'Literate CoffeeScript': 'CoffeeScript', 'C2hs Haskell': 'Haskell', 'DIGITAL Command Language': 'DCL', 'Vim script': 'VimL',
}
# Extensions Linguist gives to a programming language that are, in a legacy estate, more often something else (a Windows executable,
# a mail message, an armored key, a troff file, a macOS application bundle): left out, the file is read as "Other".
LINGUIST_NOT_SOURCE = {'.com', '.app', '.asc', '.msg', '.nr', '.pat', '.por', '.ice', '.sw', '.tm', '.vs', '.fp'}
# File names (lower case) that name a language without an extension.
FILENAMES = {
    'makefile': 'Makefile', 'gnumakefile': 'Makefile', 'dockerfile': 'Dockerfile', 'cmakelists.txt': 'CMake', 'rakefile': 'Ruby',
    'gemfile': 'Ruby', 'jenkinsfile': 'Groovy', 'vagrantfile': 'Ruby', 'podfile': 'Ruby', 'build.gradle': 'Groovy',
    'settings.gradle': 'Groovy', 'pom.xml': 'XML',
}


def clean_name(name):
    name = name.strip()
    return CANONICAL.get(name, name)


def collect():
    by_extension, by_filename = defaultdict(set), defaultdict(set)
    for _, (module, name, _aliases, filenames, _mimes) in LEXERS.items():
        module = module.replace('pygments.lexers.', '')
        if module in EXCLUDED_MODULES or any(part.lower() in name.lower() for part in EXCLUDED_NAME_PARTS):
            continue
        for pattern in filenames:
            if pattern.startswith('*.') and pattern.count('.') == 1 and not any(c in pattern[2:] for c in '*?[]'):
                by_extension['.' + pattern[2:].lower()].add(clean_name(name))
            elif not any(c in pattern for c in '*?[]') and '/' not in pattern:
                by_filename[pattern.lower()].add(clean_name(name))
    return by_extension, by_filename


def load_linguist(path):
    if path:
        text = open(path, encoding='utf-8').read()
    else:
        with urllib.request.urlopen(LINGUIST_URL, timeout=60) as response:
            text = response.read().decode('utf-8')
    return yaml.safe_load(text)


def add_linguist(by_extension, by_filename, catalogue):
    """Add the programming languages of Linguist for the extensions and the file names Pygments does not have: what Pygments says stays."""
    pygments_extensions, pygments_filenames = set(by_extension), set(by_filename)
    known = {name.lower(): name for names in list(by_extension.values()) + list(by_filename.values()) for name in names}
    known.update({name.lower(): name for name in CURATED.values()})

    def canonical(name):
        name = LINGUIST_ALIASES.get(name, name)
        return known.get(name.lower(), name)

    for name, entry in catalogue.items():
        if entry.get('type') != 'programming':
            continue
        for extension in entry.get('extensions', []):
            extension = extension.lower()
            if re.fullmatch(r'\.[^\s./*?\[\]]+', extension) and extension not in LINGUIST_NOT_SOURCE and extension not in pygments_extensions:
                by_extension[extension].add(canonical(name))
        for filename in entry.get('filenames', []):
            if '/' not in filename and not any(c in filename for c in '*?[]') and filename.lower() not in pygments_filenames:
                by_filename[filename.lower()].add(canonical(name))


def build(catalogue=None):
    by_extension, by_filename = collect()
    if catalogue:
        add_linguist(by_extension, by_filename, catalogue)
    extensions, conflicts = {}, {}
    for extension in sorted(by_extension):
        names = sorted(by_extension[extension])
        if extension in CURATED:
            continue
        if extension in AMBIGUOUS_TO_OTHER:
            continue
        if len(names) == 1:
            extensions[extension] = names[0]
        else:
            conflicts[extension] = names
    extensions.update(CURATED)
    filenames = {}
    for filename in sorted(by_filename):
        names = sorted(by_filename[filename])
        if filename in FILENAMES:
            filenames[filename] = FILENAMES[filename]
        elif len(names) == 1:
            filenames[filename] = names[0]
    for filename, name in FILENAMES.items():
        filenames[filename] = name
    return dict(sorted(extensions.items())), dict(sorted(filenames.items())), conflicts


def render(extensions, filenames):
    lines = [
        '"""The language of a source file by its extension or its name, for `inventory.py`.',
        '',
        f'Generated by scripts/gen_languages.py from Pygments {pygments.__version__}: do not edit; change the generator and run it again.',
        'Standard library only; unknown extensions and names are "Other".',
        '"""',
        '',
        'EXTENSIONS = {',
    ]
    lines += [f'    {extension!r}: {name!r},' for extension, name in extensions.items()]
    lines += ['}', '', 'FILENAMES = {']
    lines += [f'    {filename!r}: {name!r},' for filename, name in filenames.items()]
    lines += ['}', '']
    return '\n'.join(lines)


def main():
    parser = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    parser.add_argument('--check', action='store_true', help='exit 1 when languages.py is not what would be generated')
    parser.add_argument('--linguist', help='a local copy of Linguist\'s languages.yml (default: downloaded at the pinned commit)')
    args = parser.parse_args()
    extensions, filenames, conflicts = build(load_linguist(args.linguist))
    text = render(extensions, filenames)
    for extension, names in sorted(conflicts.items()):
        print(f'ambiguous {extension}: {", ".join(names)}', file=sys.stderr)
    if args.check:
        current = open(OUT, encoding='utf-8').read() if os.path.exists(OUT) else ''
        return 0 if current == text else 1
    with open(OUT, 'w', encoding='utf-8', newline='\n') as handle:
        handle.write(text)
    print(f'{len(extensions)} extensions, {len(filenames)} file names, {len(set(extensions.values()) | set(filenames.values()))} languages -> {OUT}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
