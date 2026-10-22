#!/usr/bin/env python3
"""Generate `languages.py` of the reverse_engineering plugin from the Pygments lexer catalogue.

    python scripts/gen_languages.py [--check]

`inventory.py` names the language of a file by its extension or its file name. The table it uses is generated here: Pygments knows
the extensions and the file names of about 600 languages, and this script keeps the programming, scripting, query, hardware and
template languages, drops data, configuration, log and documentation formats, and applies the curated choices below for the
extensions several languages claim. The result is committed (`languages.py` is standard library only, the plugin does not need
Pygments); run this script again after a Pygments upgrade or a change to the curated part, and review the diff.

--check exits 1 when the committed file differs from what would be generated.
"""
import argparse
import os
import sys
from collections import defaultdict

try:
    import pygments
    from pygments.lexers._mapping import LEXERS
except ImportError:
    sys.exit('gen_languages.py needs Pygments (pip install pygments)')

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
}
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


def build():
    by_extension, by_filename = collect()
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
    args = parser.parse_args()
    extensions, filenames, conflicts = build()
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
