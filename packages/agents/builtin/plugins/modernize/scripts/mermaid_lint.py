#!/usr/bin/env python3
"""Offline lint for Mermaid diagrams written by Kintsugi agents (skills/mermaid-diagrams).

Usage: mermaid_lint.py [--no-render] PATH...

PATH is a `.mmd` file, a Markdown file (its ```mermaid fences are checked) or a directory
(searched for both). Every problem is printed as `path:line: rule: message`; the exit code
is 0 when every diagram is clean, 1 when a problem was found and 2 for a usage error.

The checks are a deliberately small subset of Mermaid's grammar, tuned to the rules of the
mermaid-diagrams skill: a known header, balanced blocks, safe ids, quoted labels, defined
classes, valid erDiagram cardinalities and the size limits. They catch what breaks
rendering most often; they do not prove that a diagram renders. When the Mermaid CLI
(`mmdc`) is on PATH, each diagram is also rendered (skip with --no-render); without it the
render check is skipped silently. Standard library only, no network access (ADR-0029).
"""

from __future__ import annotations

import os
import re
import shutil
import subprocess
import sys
import tempfile
from typing import NamedTuple

MAX_EDGES = 40
MAX_NODES = 25
MAX_PARTICIPANTS = 12

HEADERS = {
    "flowchart", "graph", "sequenceDiagram", "erDiagram", "stateDiagram-v2", "stateDiagram", "classDiagram",
    "C4Context", "C4Container", "C4Component", "C4Dynamic", "C4Deployment", "gantt", "pie", "journey",
    "gitGraph", "mindmap", "timeline", "quadrantChart", "requirementDiagram", "sankey-beta", "xychart-beta",
    "block-beta", "architecture-beta", "packet-beta", "kanban",
}
# Types the skill rules out for Kintsugi artifacts, and what to use instead.
DISCOURAGED = {
    "graph": "write `flowchart` instead of `graph`",
    "architecture-beta": "use a flowchart with subgraphs, or C4Container",
    "C4Component": "stay at container level (C4Container) or use a flowchart",
    "gantt": "draw phases as a `flowchart LR` of sequence and dependencies; a gantt encodes durations",
}
DIRECTIONS = {"TB", "TD", "BT", "RL", "LR"}
RESERVED = {
    "end", "default", "style", "class", "classdef", "linkstyle", "click", "call", "href", "subgraph",
    "graph", "flowchart", "interpolate",
}
ID = re.compile(r"^[A-Za-z][A-Za-z0-9_]*$")
SAFE_EDGE_LABEL = re.compile(r"^[A-Za-z0-9 _.,\-]*$")
RAW_HTML = re.compile(r"<(?!br\s*/?>)", re.IGNORECASE)
FENCE_OPEN = re.compile(r"^\s*(```|~~~)\s*mermaid\s*$")
UNSAFE_STATEMENT = re.compile(r"^(click|href|call)\b")

SHAPES = [
    ("(((", ")))"), ("[[", "]]"), ("[(", ")]"), ("([", "])"), ("((", "))"), ("{{", "}}"),
    ("[/", None), ("[\\", None), ("[", "]"), ("(", ")"), ("{", "}"), (">", "]"),
]
EDGE = re.compile(r"(?:<|o(?=[-=.])|x(?=[-=.]))?(?:[-=.~]{2,})(?:>|o\b|x\b|o(?=\s)|x(?=\s))?")


class Problem(NamedTuple):
    line: int
    rule: str
    message: str


# ---------------------------------------------------------------------------
# Shared helpers
# ---------------------------------------------------------------------------


def _strip_comment(line: str) -> tuple[str, bool]:
    """The statement without a trailing `%%` comment, and whether one was there."""
    in_quote = False
    for index, char in enumerate(line):
        if char == '"':
            in_quote = not in_quote
        elif not in_quote and line.startswith("%%", index):
            return line[:index].rstrip(), True
    return line, False


def _check_id(name: str, line: int, problems: list[Problem], what: str = "id") -> None:
    if not ID.match(name):
        problems.append(Problem(line, "invalid-id", f"{what} `{name}` must match [A-Za-z][A-Za-z0-9_]*; sanitize it and keep the text in a quoted label"))
    elif name.lower() in RESERVED:
        problems.append(Problem(line, "reserved-id", f"{what} `{name}` is a Mermaid keyword; prefix it (e.g. `n_{name}`)"))
    elif name[0] in "ox":
        # `o`/`x` right after an edge turn it into a circle/cross edge: keep ids off a bare o/x start.
        problems.append(Problem(line, "ox-start", f"{what} `{name}` starts with `{name[0]}`, which can merge into the edge before it; use a kind prefix"))


def _check_label_text(text: str, line: int, problems: list[Problem]) -> None:
    if RAW_HTML.search(text) or ">" in text.replace("<br>", "").replace("<br/>", "").replace("<br />", ""):
        problems.append(Problem(line, "raw-html", "write < and > as #lt; and #gt; in labels (only <br/> is allowed)"))


def _quotes_balanced(text: str) -> bool:
    return text.replace("#quot;", "").count('"') % 2 == 0


# ---------------------------------------------------------------------------
# Flowchart
# ---------------------------------------------------------------------------


class _FlowLine:
    """A tiny lexer over one flowchart statement: nodes, edges, `&` and `:::class`."""

    def __init__(self, text: str, line: int, problems: list[Problem]):
        self.text = text
        self.pos = 0
        self.line = line
        self.problems = problems
        self.nodes: list[str] = []
        self.labelled: list[str] = []
        self.classes: list[str] = []
        self.edges = 0

    def _ws(self) -> None:
        while self.pos < len(self.text) and self.text[self.pos] in " \t":
            self.pos += 1

    def _fail(self, rule: str, message: str) -> bool:
        self.problems.append(Problem(self.line, rule, message))
        return False

    def _label(self, closers: tuple[str, ...]) -> bool:
        self._ws()
        if self.text.startswith('"', self.pos):
            end = self.text.find('"', self.pos + 1)
            if end == -1:
                return self._fail("unbalanced-quote", "a label opens a quote it never closes")
            _check_label_text(self.text[self.pos + 1:end], self.line, self.problems)
            self.pos = end + 1
            self._ws()
            for closer in closers:
                if self.text.startswith(closer, self.pos):
                    self.pos += len(closer)
                    return True
            return self._fail("unclosed-shape", "a node shape is not closed after its quoted label")
        ends = [(self.text.find(closer, self.pos), closer) for closer in closers]
        found = [(index, closer) for index, closer in ends if index != -1]
        if not found:
            return self._fail("unclosed-shape", "a node shape is not closed")
        index, closer = min(found)
        self.problems.append(Problem(self.line, "unquoted-label", 'quote every node label: id["text"]'))
        self.pos = index + len(closer)
        return True

    def _node(self) -> bool:
        self._ws()
        match = re.compile(r"[A-Za-z0-9_]+").match(self.text, self.pos)
        if match is None:
            rest = self.text[self.pos:self.pos + 20]
            return self._fail("unparsed-line", f"expected a node id at `{rest}`")
        name = match.group(0)
        self.pos = match.end()
        nxt = self.text[self.pos:self.pos + 1]
        if nxt != "" and (nxt not in " \t[({>&:;-=.~<" or (nxt in "-." and EDGE.match(self.text, self.pos) is None)):
            return self._fail("invalid-id", f"node id `{name}{nxt}…` contains a character ids may not hold; use [A-Za-z][A-Za-z0-9_]*")
        _check_id(name, self.line, self.problems, "node id")
        self.nodes.append(name)
        for opener, closer in SHAPES:
            if self.text.startswith(opener, self.pos):
                self.pos += len(opener)
                closers = (closer,) if closer is not None else ("/]", "\\]")
                if not self._label(closers):
                    return False
                self.labelled.append(name)
                break
        if self.text.startswith(":::", self.pos):
            match = re.compile(r":::([A-Za-z0-9_-]+)").match(self.text, self.pos)
            if match is None:
                return self._fail("unparsed-line", "`:::` must be followed by a class name")
            self.classes.append(match.group(1))
            self.pos = match.end()
        return True

    def _group(self) -> int | None:
        count = 0
        while True:
            if not self._node():
                return None
            count += 1
            self._ws()
            if self.text.startswith("&", self.pos):
                self.pos += 1
                continue
            return count

    def parse(self) -> None:
        left = self._group()
        if left is None:
            return
        while True:
            self._ws()
            if self.pos >= len(self.text):
                return
            match = EDGE.match(self.text, self.pos)
            if match is None:
                self._fail("unparsed-line", f"expected an edge at `{self.text[self.pos:self.pos + 20]}`")
                return
            token = match.group(0)
            self.pos = match.end()
            if token in ("--", "-.", "==") and self.text[self.pos:self.pos + 1] in (" ", "\t"):
                self._fail("inline-edge-label", 'write edge text as -->|"label"|, not -- label -->')
                return
            self._ws()
            if self.text.startswith("|", self.pos):
                end_quote = self.pos + 1
                if self.text.startswith('"', end_quote):
                    close = self.text.find('"', end_quote + 1)
                    if close == -1:
                        self._fail("unbalanced-quote", "an edge label opens a quote it never closes")
                        return
                    _check_label_text(self.text[end_quote + 1:close], self.line, self.problems)
                    end = self.text.find("|", close)
                else:
                    end = self.text.find("|", end_quote)
                    if end != -1 and not SAFE_EDGE_LABEL.match(self.text[end_quote:end]):
                        self.problems.append(Problem(self.line, "unquoted-label", 'quote edge labels with special characters: -->|"text"|'))
                if end == -1:
                    self._fail("unparsed-line", "an edge label `|…|` is not closed")
                    return
                self.pos = end + 1
            right = self._group()
            if right is None:
                return
            self.edges += left * right
            left = right


def _lint_flowchart(lines: list[tuple[int, str]], header_line: int, problems: list[Problem]) -> None:
    stack: list[int] = []
    defined: set[str] = set()
    used: list[tuple[int, str]] = []
    nodes: set[str] = set()
    subgraphs: set[str] = set()
    edges = 0
    for number, text in lines:
        statement = text.strip().rstrip(";").strip()
        if statement == "":
            continue
        keyword = statement.split()[0]
        if keyword == "subgraph":
            stack.append(number)
            match = re.match(r"subgraph\s+([^\s\[\"]+)?\s*(.*)$", statement)
            name, title = (match.group(1), match.group(2).strip()) if match else (None, "")
            if name is None:
                problems.append(Problem(number, "subgraph-id", 'give every subgraph an id: subgraph dom_x["Title"]'))
            else:
                _check_id(name, number, problems, "subgraph id")
                subgraphs.add(name)
            if title and not re.fullmatch(r'\["[^"]*"\]', title):
                problems.append(Problem(number, "unquoted-label", 'write subgraph titles as subgraph id["Title"]'))
            continue
        if keyword == "end":
            if statement != "end":
                problems.append(Problem(number, "unparsed-line", "`end` closes a subgraph and takes nothing after it"))
            if stack:
                stack.pop()
            else:
                problems.append(Problem(number, "unbalanced-block", "`end` without an open subgraph"))
            continue
        if keyword == "direction":
            if len(statement.split()) != 2 or statement.split()[1] not in DIRECTIONS:
                problems.append(Problem(number, "unparsed-line", "direction takes one of TB, TD, BT, RL, LR"))
            continue
        if keyword == "classDef":
            parts = statement.split(None, 2)
            if len(parts) < 3:
                problems.append(Problem(number, "unparsed-line", "classDef needs a name and styles"))
            else:
                defined.update(name for name in parts[1].split(",") if name)
            continue
        if keyword == "class":
            parts = statement.split()
            if len(parts) != 3:
                problems.append(Problem(number, "unparsed-line", "write `class id1,id2 className`"))
            else:
                used.append((number, parts[2]))
            continue
        if keyword in ("style", "linkStyle"):
            continue
        tokens = _FlowLine(statement, number, problems)
        tokens.parse()
        nodes.update(tokens.nodes)
        used.extend((number, name) for name in tokens.classes)
        edges += tokens.edges
    for start in stack:
        problems.append(Problem(start, "unbalanced-block", "subgraph is never closed with `end`"))
    for number, name in used:
        if name not in defined:
            problems.append(Problem(number, "undefined-class", f"class `{name}` has no classDef"))
    nodes -= subgraphs
    if edges > MAX_EDGES:
        problems.append(Problem(header_line, "too-many-edges", f"{edges} edges (limit {MAX_EDGES}): collapse to domain level or split into <name>-<part>.mmd with an index diagram"))
    if len(nodes) > MAX_NODES:
        problems.append(Problem(header_line, "too-many-nodes", f"{len(nodes)} nodes (limit {MAX_NODES}): collapse to domain level or split into <name>-<part>.mmd with an index diagram"))


# ---------------------------------------------------------------------------
# Sequence diagram
# ---------------------------------------------------------------------------

SEQ_OPEN = {"alt", "opt", "loop", "par", "critical", "break", "rect", "box"}
SEQ_MIDDLE = {"else": "alt", "and": "par", "option": "critical"}
SEQ_ARROW = r"(?:<<)?-{1,2}(?:>>|>|x|\))"
SEQ_MESSAGE = re.compile(r"^([^\s:+-][^:]*?)\s*(" + SEQ_ARROW + r")\s*([+-]?)\s*([^:]+?)\s*:(.*)$")
SEQ_PARTICIPANT = re.compile(r"^(participant|actor)\s+(\S+)(?:\s+as\s+(.+))?$")
SEQ_NOTE = re.compile(r"^[Nn]ote\s+(?:over|left of|right of)\s+([^:]+):(.*)$")


def _lint_sequence(lines: list[tuple[int, str]], header_line: int, problems: list[Problem]) -> None:
    stack: list[tuple[int, str]] = []
    participants: set[str] = set()

    def participant(name: str, number: int) -> None:
        name = name.strip()
        if name not in participants:
            _check_id(name, number, problems, "participant id")
            participants.add(name)

    def text_check(text: str, number: int) -> None:
        if ";" in text.replace("#59;", "").replace("#quot;", "").replace("#lt;", "").replace("#gt;", "").replace("#35;", ""):
            problems.append(Problem(number, "unescaped-semicolon", "write ; as #59; in sequence text"))

    for number, text in lines:
        statement = text.strip()
        if statement == "":
            continue
        keyword = statement.split()[0]
        if keyword in SEQ_OPEN:
            stack.append((number, keyword))
            text_check(statement[len(keyword):], number)
            continue
        if keyword in SEQ_MIDDLE:
            if not stack or stack[-1][1] != SEQ_MIDDLE[keyword]:
                problems.append(Problem(number, "unbalanced-block", f"`{keyword}` outside a `{SEQ_MIDDLE[keyword]}` block"))
            continue
        if keyword == "end":
            if stack:
                stack.pop()
            else:
                problems.append(Problem(number, "unbalanced-block", "`end` without an open block"))
            continue
        if keyword in ("autonumber", "title", "activate", "deactivate", "create", "destroy", "link", "links"):
            if keyword in ("activate", "deactivate", "destroy") and len(statement.split()) > 1:
                participant(statement.split()[1], number)
            continue
        match = SEQ_PARTICIPANT.match(statement)
        if match:
            participant(match.group(2), number)
            if match.group(3):
                text_check(match.group(3), number)
            continue
        match = SEQ_NOTE.match(statement)
        if match:
            for name in match.group(1).split(","):
                participant(name, number)
            text_check(match.group(2), number)
            continue
        match = SEQ_MESSAGE.match(statement)
        if match:
            participant(match.group(1), number)
            participant(match.group(4), number)
            text_check(match.group(5), number)
            continue
        problems.append(Problem(number, "unparsed-line", "not a sequenceDiagram statement (participant, message `A->>B: text`, note, block or end)"))
    for start, keyword in stack:
        problems.append(Problem(start, "unbalanced-block", f"`{keyword}` is never closed with `end`"))
    if len(participants) > MAX_PARTICIPANTS:
        problems.append(Problem(header_line, "too-many-participants", f"{len(participants)} participants (limit {MAX_PARTICIPANTS}): group them or split the flow"))


# ---------------------------------------------------------------------------
# erDiagram
# ---------------------------------------------------------------------------

ER_RELATION = re.compile(r"^(\S+)\s+(\S+?)(--|\.\.)(\S+?)\s+(\S+)\s*:\s*(.*)$")
ER_LEFT = {"||", "|o", "}o", "}|"}
ER_RIGHT = {"||", "o|", "o{", "|{"}
ER_ENTITY = re.compile(r"^([A-Za-z][A-Za-z0-9_-]*)\s*(?:\[\s*\"[^\"]*\"\s*\])?\s*\{$")
ER_ATTRIBUTE = re.compile(r'^(\S+)\s+(\S+)((?:\s+(?:PK|FK|UK)(?:\s*,\s*(?:PK|FK|UK))*)?)(\s+"[^"]*")?$')
ER_NAME = re.compile(r"^[A-Za-z][A-Za-z0-9_-]*$")


def _lint_er(lines: list[tuple[int, str]], header_line: int, problems: list[Problem]) -> None:
    entities: set[str] = set()
    relations = 0
    open_entity: int | None = None
    for number, text in lines:
        statement = text.strip()
        if statement == "":
            continue
        if open_entity is not None:
            if statement == "}":
                open_entity = None
            elif not ER_ATTRIBUTE.match(statement):
                problems.append(Problem(number, "er-attribute", 'write attributes as `type name [PK|FK|UK] ["comment"]`'))
            continue
        match = ER_ENTITY.match(statement)
        if match:
            entities.add(match.group(1))
            open_entity = number
            continue
        if statement.startswith("direction "):
            continue
        match = ER_RELATION.match(statement)
        if match:
            left, _, right = match.group(2), match.group(3), match.group(4)
            if left not in ER_LEFT or right not in ER_RIGHT:
                problems.append(Problem(number, "er-cardinality", f"`{left}{match.group(3)}{right}`: use ||, |o, }}o or }}| on the left and ||, o|, o{{ or |{{ on the right"))
            for name in (match.group(1), match.group(5)):
                if not ER_NAME.match(name):
                    problems.append(Problem(number, "invalid-id", f"entity `{name}` must match [A-Za-z][A-Za-z0-9_-]*"))
                entities.add(name)
            label = match.group(6).strip()
            if label == "":
                problems.append(Problem(number, "er-cardinality", "a relationship needs a label after `:`"))
            elif not (label.startswith('"') and label.endswith('"') and len(label) > 1) and not re.fullmatch(r"[A-Za-z0-9_-]+", label):
                problems.append(Problem(number, "unquoted-label", 'quote relationship labels with spaces or symbols: : "label"'))
            relations += 1
            continue
        if ER_NAME.match(statement):
            entities.add(statement)
            continue
        problems.append(Problem(number, "er-cardinality" if ("--" in statement or ".." in statement) else "unparsed-line", "not an erDiagram statement (`A ||--o{ B : label`, an entity block or an entity name)"))
    if open_entity is not None:
        problems.append(Problem(open_entity, "unbalanced-block", "entity block is never closed with `}`"))
    if relations > MAX_EDGES:
        problems.append(Problem(header_line, "too-many-edges", f"{relations} relationships (limit {MAX_EDGES}): split the model by domain"))
    if len(entities) > MAX_NODES:
        problems.append(Problem(header_line, "too-many-nodes", f"{len(entities)} entities (limit {MAX_NODES}): split the model by domain"))


# ---------------------------------------------------------------------------
# stateDiagram-v2
# ---------------------------------------------------------------------------

STATE_TRANSITION = re.compile(r"^(\[\*\]|[^\s:-]+)\s*-->\s*(\[\*\]|[^\s:]+)\s*(?::(.*))?$")


def _lint_state(lines: list[tuple[int, str]], header_line: int, problems: list[Problem]) -> None:
    stack: list[int] = []
    states: set[str] = set()
    transitions = 0
    in_note = False
    for number, text in lines:
        statement = text.strip()
        if statement == "":
            continue
        if in_note:
            in_note = statement != "end note"
            continue
        if re.match(r"^note\s+(left|right)\s+of\s+\S+\s*$", statement):
            in_note = True
            continue
        if statement == "}":
            if stack:
                stack.pop()
            else:
                problems.append(Problem(number, "unbalanced-block", "`}` without an open composite state"))
            continue
        if statement.endswith("{"):
            stack.append(number)
        match = STATE_TRANSITION.match(statement)
        if match:
            for name in (match.group(1), match.group(2)):
                if name != "[*]" and name not in states:
                    _check_id(name, number, problems, "state id")
                    states.add(name)
            if match.group(3) and ";" in match.group(3).replace("#59;", ""):
                problems.append(Problem(number, "unescaped-semicolon", "write ; as #59; in transition labels"))
            transitions += 1
            continue
        if not _quotes_balanced(statement):
            problems.append(Problem(number, "unbalanced-quote", "a quote is opened and never closed"))
    for start in stack:
        problems.append(Problem(start, "unbalanced-block", "composite state is never closed with `}`"))
    if transitions > MAX_EDGES:
        problems.append(Problem(header_line, "too-many-edges", f"{transitions} transitions (limit {MAX_EDGES}): split the lifecycle"))
    if len(states) > MAX_NODES:
        problems.append(Problem(header_line, "too-many-nodes", f"{len(states)} states (limit {MAX_NODES}): split the lifecycle"))


# ---------------------------------------------------------------------------
# C4
# ---------------------------------------------------------------------------

C4_ELEMENTS = {
    "Person", "Person_Ext", "System", "System_Ext", "SystemDb", "SystemDb_Ext", "SystemQueue", "SystemQueue_Ext",
    "Container", "Container_Ext", "ContainerDb", "ContainerDb_Ext", "ContainerQueue", "ContainerQueue_Ext",
    "Component", "Component_Ext", "ComponentDb", "ComponentDb_Ext", "ComponentQueue", "ComponentQueue_Ext",
    "Deployment_Node", "Node", "Node_L", "Node_R",
}
C4_BOUNDARIES = {"Boundary", "Enterprise_Boundary", "System_Boundary", "Container_Boundary"}
C4_RELATIONS = {"Rel", "BiRel", "Rel_U", "Rel_Up", "Rel_D", "Rel_Down", "Rel_L", "Rel_Left", "Rel_R", "Rel_Right", "Rel_Back", "RelIndex"}
C4_STYLE = {"UpdateElementStyle", "UpdateRelStyle", "UpdateLayoutConfig", "UpdateBoundaryStyle"}
C4_CALL = re.compile(r"^([A-Za-z_]+)\s*\((.*)\)\s*(\{)?$")


def _split_args(text: str) -> list[str] | None:
    args, current, in_quote = [], [], False
    for char in text:
        if char == '"':
            in_quote = not in_quote
        if char == "," and not in_quote:
            args.append("".join(current).strip())
            current = []
        else:
            current.append(char)
    if in_quote:
        return None
    args.append("".join(current).strip())
    return args


def _lint_c4(lines: list[tuple[int, str]], header_line: int, problems: list[Problem]) -> None:
    stack: list[int] = []
    defined: set[str] = set()
    references: list[tuple[int, str]] = []
    elements = 0
    relations = 0
    for number, text in lines:
        statement = text.strip()
        if statement == "":
            continue
        if statement == "}":
            if stack:
                stack.pop()
            else:
                problems.append(Problem(number, "unbalanced-block", "`}` without an open boundary"))
            continue
        if statement.startswith("title "):
            continue
        match = C4_CALL.match(statement)
        if match is None:
            problems.append(Problem(number, "unparsed-line", "not a C4 statement (`Macro(id, \"label\", …)`, a boundary or `}`)"))
            continue
        name, raw, brace = match.group(1), match.group(2), match.group(3)
        args = _split_args(raw)
        if args is None:
            problems.append(Problem(number, "unbalanced-quote", "a quote is opened and never closed"))
            continue
        if name in C4_STYLE:
            continue
        if name in C4_ELEMENTS or name in C4_BOUNDARIES:
            if brace:
                stack.append(number)
            elif name in C4_BOUNDARIES:
                problems.append(Problem(number, "unbalanced-block", "a boundary opens with `{` on its own line"))
            _check_id(args[0], number, problems, "element id")
            defined.add(args[0])
            for arg in args[1:]:
                if arg and not arg.startswith("$") and not (arg.startswith('"') and arg.endswith('"') and len(arg) > 1):
                    problems.append(Problem(number, "unquoted-label", 'quote every C4 label argument: "text"'))
                _check_label_text(arg, number, problems)
            if name in C4_ELEMENTS:
                elements += 1
            continue
        if name in C4_RELATIONS:
            offset = 1 if name == "RelIndex" else 0
            if len(args) < offset + 3:
                problems.append(Problem(number, "unparsed-line", f"{name} takes (from, to, \"label\"[, \"technology\"])"))
                continue
            references.extend((number, ref) for ref in args[offset:offset + 2])
            for arg in args[offset + 2:]:
                if arg and not arg.startswith("$") and not (arg.startswith('"') and arg.endswith('"') and len(arg) > 1):
                    problems.append(Problem(number, "unquoted-label", 'quote every C4 label argument: "text"'))
            relations += 1
            continue
        problems.append(Problem(number, "unknown-statement", f"`{name}` is not a C4 macro this skill uses"))
    for start in stack:
        problems.append(Problem(start, "unbalanced-block", "boundary is never closed with `}`"))
    for number, ref in references:
        if ref not in defined:
            problems.append(Problem(number, "undefined-ref", f"relationship names `{ref}`, which no element defines"))
    if relations > MAX_EDGES:
        problems.append(Problem(header_line, "too-many-edges", f"{relations} relationships (limit {MAX_EDGES}): split the view"))
    if elements > MAX_NODES:
        problems.append(Problem(header_line, "too-many-nodes", f"{elements} elements (limit {MAX_NODES}): split the view"))


# ---------------------------------------------------------------------------
# Entry points
# ---------------------------------------------------------------------------

LINTERS = {
    "flowchart": _lint_flowchart,
    "graph": _lint_flowchart,
    "sequenceDiagram": _lint_sequence,
    "erDiagram": _lint_er,
    "stateDiagram-v2": _lint_state,
    "stateDiagram": _lint_state,
    "C4Context": _lint_c4,
    "C4Container": _lint_c4,
    "C4Component": _lint_c4,
    "C4Dynamic": _lint_c4,
    "C4Deployment": _lint_c4,
}


def lint_diagram(text: str, first_line: int = 1) -> list[Problem]:
    """Problems of one diagram; `first_line` is the file line of the diagram's first line."""
    problems: list[Problem] = []
    raw = text.replace("\r\n", "\n").split("\n")
    lines: list[tuple[int, str]] = []
    for offset, line in enumerate(raw):
        number = first_line + offset
        stripped = line.strip()
        if stripped.startswith("%%{"):
            problems.append(Problem(number, "no-theming", "no %%{init}%% directives: the portal themes diagrams"))
            continue
        if stripped.startswith("%%"):
            continue
        if stripped.startswith("%"):
            problems.append(Problem(number, "bad-comment", "comments start with %%"))
            continue
        statement, had_comment = _strip_comment(line)
        if had_comment:
            problems.append(Problem(number, "inline-comment", "put %% comments on their own line"))
        if UNSAFE_STATEMENT.match(statement.strip()):
            problems.append(Problem(number, "no-click", "no click/href/call statements: diagrams hold no links or callbacks"))
            continue
        if not _quotes_balanced(statement):
            problems.append(Problem(number, "unbalanced-quote", "a quote is opened and never closed"))
            continue
        lines.append((number, statement))
    content = [(number, line) for number, line in lines if line.strip() != ""]
    if not content:
        problems.append(Problem(first_line, "empty-diagram", "the diagram is empty"))
        return problems
    header_line, header = content[0]
    if header.strip() == "---":
        problems.append(Problem(header_line, "no-theming", "no front matter: start with the diagram type"))
        return problems
    words = header.split()
    kind = words[0]
    if kind not in HEADERS:
        problems.append(Problem(header_line, "unknown-header", f"`{kind}` is not a Mermaid diagram type"))
        return problems
    if kind in DISCOURAGED:
        problems.append(Problem(header_line, "discouraged-type", DISCOURAGED[kind]))
    if kind in ("flowchart", "graph"):
        if len(words) > 2 or (len(words) == 2 and words[1] not in DIRECTIONS):
            problems.append(Problem(header_line, "unknown-header", f"`{kind}` takes one direction: TB, TD, BT, RL or LR"))
    elif len(words) > 1:
        problems.append(Problem(header_line, "unknown-header", f"`{kind}` takes nothing after it on the header line"))
    linter = LINTERS.get(kind)
    if linter is not None:
        linter(content[1:], header_line, problems)
    return sorted(problems, key=lambda problem: (problem.line, problem.rule))


def extract_blocks(text: str) -> tuple[list[tuple[int, str]], list[Problem]]:
    """The ```mermaid fences of a Markdown text: (line of the first diagram line, diagram text)."""
    blocks: list[tuple[int, str]] = []
    problems: list[Problem] = []
    lines = text.replace("\r\n", "\n").split("\n")
    index = 0
    while index < len(lines):
        match = FENCE_OPEN.match(lines[index])
        if match is None:
            index += 1
            continue
        fence, start = match.group(1), index
        body: list[str] = []
        index += 1
        while index < len(lines) and lines[index].strip() != fence:
            body.append(lines[index])
            index += 1
        if index >= len(lines):
            problems.append(Problem(start + 1, "unclosed-fence", "the mermaid fence is never closed"))
        blocks.append((start + 2, "\n".join(body)))
        index += 1
    return blocks, problems


def diagrams_of(path: str, text: str) -> tuple[list[tuple[int, str]], list[Problem]]:
    if path.lower().endswith(".md"):
        return extract_blocks(text)
    return [(1, text)], []


def lint_text(path: str, text: str) -> list[Problem]:
    """Every problem of a `.mmd` or Markdown file's diagrams (no rendering)."""
    blocks, problems = diagrams_of(path, text)
    for first_line, diagram in blocks:
        problems.extend(lint_diagram(diagram, first_line))
    return sorted(problems, key=lambda problem: (problem.line, problem.rule))


def _render(diagram: str, mmdc: str) -> str | None:
    """Renders with the Mermaid CLI; the first error line, or None when it renders."""
    with tempfile.TemporaryDirectory() as scratch:
        source = os.path.join(scratch, "diagram.mmd")
        with open(source, "w", encoding="utf-8") as handle:
            handle.write(diagram)
        try:
            result = subprocess.run([mmdc, "-q", "-i", source, "-o", os.path.join(scratch, "diagram.svg")], capture_output=True, text=True, timeout=120, check=False)
        except (OSError, subprocess.TimeoutExpired) as error:
            return f"mmdc could not run: {type(error).__name__}"
        if result.returncode == 0:
            return None
        lines = [line.strip() for line in (result.stderr or result.stdout).splitlines() if line.strip()]
        return lines[0][:200] if lines else f"mmdc exited with {result.returncode}"


def files_of(paths: list[str]) -> list[str]:
    found: list[str] = []
    for path in paths:
        if os.path.isdir(path):
            for root, dirs, names in os.walk(path):
                dirs[:] = sorted(name for name in dirs if not name.startswith(".") and name != "node_modules")
                found.extend(os.path.join(root, name) for name in sorted(names) if name.lower().endswith((".mmd", ".md")))
        else:
            found.append(path)
    return found


def main(argv: list[str]) -> int:
    render = "--no-render" not in argv
    paths = [arg for arg in argv if arg != "--no-render"]
    if not paths or any(arg.startswith("-") for arg in paths):
        print("usage: mermaid_lint.py [--no-render] PATH...", file=sys.stderr)
        return 2
    mmdc = shutil.which("mmdc") if render else None
    failed = False
    for path in files_of(paths):
        try:
            with open(path, encoding="utf-8") as handle:
                text = handle.read()
        except (OSError, UnicodeDecodeError) as error:
            print(f"{path}:1: unreadable: {type(error).__name__}")
            failed = True
            continue
        problems = lint_text(path, text)
        if mmdc is not None and not problems:
            for first_line, diagram in diagrams_of(path, text)[0]:
                error = _render(diagram, mmdc)
                if error is not None:
                    problems.append(Problem(first_line, "render-failed", error))
        for problem in problems:
            print(f"{path}:{problem.line}: {problem.rule}: {problem.message}")
        failed = failed or bool(problems)
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
