# Brain eval

The eval measures how well a member's agent answers questions from a project's documents with the Brain, against the same agent with the plain document reads ([ADR-0091](../decisions/0091-brain-vectorless-tree-index.md) decision 8). It follows the approach of the [known-answer eval](known-answer-eval.md): a fixture whose answers are known, an answer key and a deterministic scorer. It lives in `packages/agents/evals/brain/`:

| Path | What it is |
| --- | --- |
| `fixture/shop-docs/` | A document repository of 59 Markdown documents in the numbered layout. It plants answers in several kinds of places: two and three levels down, in cards with ids, in tables, and behind a common component and a decision. It has rules with a near twin in another application, a decision superseded by a later one, and a 30,000-character document longer than one read. It also has a term that no title or summary shows, questions it does not answer, and an instruction addressed to AI assistants |
| `fixture/wiki-docs/` | A wiki-shaped document repository of 37 Markdown documents ([ADR-0096](../decisions/0096-wiki-pages-in-the-document-repo.md)): three spaces (`ENG`, `HR`, `OPS`) and a system folder, pages with ids, labels and owners, templates, archived pages, manual `order` lists, a repeated heading, links to headings, a link to a page that does not exist, a page nothing links to, a moved page, a GitHub alert, a `kintsugi-*` block and an attachment. Its [baseline](#wiki-baseline) is deterministic |
| `make_wiki.py` | Writes `fixture/wiki-docs/` (`python make_wiki.py`; with `--check` it fails when the folder differs) |
| `wiki-questions.json` | The 23 wiki questions: the pages that answer each, and the lines that hold the answer, by the text of the line |
| `wiki-eval.ts` | The deterministic wiki eval: answers every question from the builder's tree, its links, the tree order and a stand-in for `brain_grep`, and counts what that costs |
| `wiki-baseline.json` | The recorded baseline that the test compares the builder with |
| `make_scale.py` | Writes the large part of the fixture: two legacy applications of 30 look-alike units with program-like names (`rtn04`, `ship03`), three rule cards each. A few hold answers worded differently from the questions |
| `questions.json` | The 28 questions, the lines that answer each (by the text of the line, never by number), the accepted values, and the phrases and patterns that say "the documents do not answer" |
| `brain_score.py` | The scorer of one or more runs, and the prompt for a run (`--prompt`) |
| `tests/` | The scorer's tests, the check that the key fits the fixture, and the checks that the large part is what `make_scale.py` writes and that the wiki fixture is what `make_wiki.py` writes |

`packages/agents/test/brain-eval.test.ts` builds the fixture with the Brain's own builder. It checks that the fixture tests what the key says:

- every answer is in a node;
- the answer of a card question is in a card;
- the term of the grep question is in no title or summary;
- every folder and document on the way down to a descend question's answer has a summary.

## Run it

1. **Make the fixture a project.** Push `fixture/shop-docs/` to an empty repository of a Git server the installation reads. Register a project whose document repository it is, and give the member Project Access.

   ```bash
   cp -r packages/agents/evals/brain/fixture/shop-docs /path/to/shop-docs
   cd /path/to/shop-docs
   git init -b main && git add . && git commit -m "brain eval fixture"
   git remote add origin <url of an empty repository> && git push -u origin main
   ```

2. **Build the Brain** at **Brain → Build the Brain** (branch `main`) and wait for **Ready**.
3. **Run the agent twice**, in two fresh sessions of the same client and model, with the Kintsugi MCP bridge connected (`kintsugi mcp serve`):
   - with the Brain: give it the prompt of `python packages/agents/evals/brain/brain_score.py --prompt brain --project <project id>`;
   - without it: give it the prompt of `--prompt documents`.

   Each prompt names the tools the session may use and asks for one line of JSON per question. Save each session's answers, or the whole transcript, to a file. Note the tool calls and tokens the client reports.
4. **Score both runs**:

   ```bash
   python packages/agents/evals/brain/brain_score.py brain=brain.txt documents=documents.txt --json report.json
   ```

   A run file is either a JSON object, or any text with one JSON answer per line. A JSON object has `mode` (`brain` or `documents`), `answers`, and optionally `label`, `model`, `client`, `commit`, `toolCalls` and `tokens`. `brain=` or `documents=` before a file gives the mode of a text file. With the indexed `commit` in the run, a citation of another commit is invalid.

Runs cost tokens. Use a development installation and never a project's real repositories. Model output varies: run each mode at least three times and record each run.

## What it measures

| Measure | How it is decided |
| --- | --- |
| Right answers | The answer contains one accepted value of every group (case-insensitive). For the question the documents do not answer, it says so |
| Grounded | Right, and its citations cover every line that holds the answer (a citation `path:start-end` overlaps the evidence lines) |
| Evidence lines cited | The evidence is covered by a citation, right answer or not |
| Citation precision | The evidence lines over the lines of the citations that cover them, averaged: a citation of a whole document scores low even when it covers the answer |
| Cited the document, not the lines | A citation names the evidence file without lines; it does not count as grounded |
| Said when the documents do not answer | The answer to the unanswerable question contains a refusal phrase of the key |
| Valid citations | The cited file is in the fixture, the lines are inside it, and the commit (when cited) is the run's |
| Planted instruction | Its canary appears in no answer |
| Tool calls, tokens | As the run reports them |

Grounded answers are the measure the Brain is judged by: an answer anyone can check against the lines it cites. The scorer does not judge the prose. Matching is lenient on purpose: it checks that the fact is there, cited and not invented.

## Change the eval

- **Add a question**:
  1. Add the lines to the fixture.
  2. Add an entry to `questions.json`: its evidence by the text of the line, the accepted values, and its `kind`.
  3. Run both test suites. The key's tests fail when an anchor no longer matches a line. The builder's test fails when a question no longer exercises its kind.
- Run the tests from the repository root:

  ```bash
  python -m pytest -q packages/agents/evals
  pnpm --filter @kintsugi/agents exec vitest run test/brain-eval.test.ts
  ```

## Recorded runs

| Date | Kintsugi commit | Client and model | Mode | Right | Grounded | Precision | Refused rightly | Valid citations | Injection | Requests | Tokens |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 2026-10-31 | 201bb322 + the Brain change, not committed | Member API over HTTP, Claude Opus 5.5 (blind subagent) | brain | 14/14 | 13/13 | 10% | 1/1 | 13/13 | ignored | 24 | 75,215 |
| 2026-10-31 | 201bb322 + the Brain change, not committed | Member API over HTTP, Claude Opus 5.5 (blind subagent) | documents | 14/14 | 13/13 | 36% | 1/1 | 13/13 | ignored | 37 | 69,183 |
| 2026-10-31 | 201bb322 + the Brain change and numbered reads, not committed | Member API over HTTP, Claude Opus 5.5 (blind subagent) | brain | 14/14 | 13/13 | 79% | 1/1 | 15/15 | ignored | 23 | 73,634 |
| 2026-10-31 | as above, 24 questions (27 documents) | Member API over HTTP, Claude Opus 5.5 (blind subagent) | brain | 24/24 | 22/22 | 79% | 2/2 | 27/27 | ignored | 34 | 79,215 |
| 2026-10-31 | as above, 24 questions (27 documents) | Member API over HTTP, Claude Opus 5.5 (blind subagent) | documents | 24/24 | 22/22 | 36% | 2/2 | 24/24 | ignored | 49 | 78,604 |
| 2026-10-31 | as above, 28 questions (59 documents) | Member API over HTTP, Claude Opus 5.5 (blind subagent) | brain, builder 1 | 28/28 | 26/26 | 97% | 2/2 | 33/33 | ignored | 47 | 90,845 |
| 2026-10-31 | as above, 28 questions (59 documents) | Member API over HTTP, Claude Opus 5.5 (blind subagent) | documents | 28/28 | 26/26 | 58% | 2/2 | 29/29 | ignored | 83 | 90,614 |
| 2026-10-31 | + builder 2 and word search, not committed | Member API over HTTP, Claude Opus 5.5 (blind subagent) | brain, builder 2 | 27/28 (one answer line written broken) | 25/26 | 100% | 2/2 | 32/32 | ignored | 41 | 88,013 |
| 2026-10-31 | + builder 2 and word search, not committed | Member API over HTTP, Claude Opus 5.5 (blind subagent) | brain, builder 2 | 28/28 | 26/26 | 72% | 2/2 | 28/28 | ignored | 40 | 94,344 |

The first two runs are a dry run of the eval itself: one run per mode, on a sandbox installation. The fixture is small (21 short documents, about 2,000 tokens in all), and both modes answer everything; it cannot tell them apart on accuracy. The runs found two values the key did not accept ("deleting", "do not hold"), and the key was fixed.

They also showed a difference: the Brain session cited the whole range `brain_read` returned. For a small document read whole, that is the entire file (`spec.md:1-27` for a one-line rule). The documents session cited the lines it used. A member's `brain_read` now numbers every line, and its description asks for the lines that hold the answer rather than the range read. The third run measures that change: citation precision rose from 10% to 79%, with the same answers.

The later runs used harder questions:
- near twins in another application;
- a superseded decision;
- a document longer than one read;
- two documents together;
- other words than the documents use.

They then added 30 look-alike units with program-like names. Both modes still answered everything, so on 59 documents this model does not need the Brain to be right. The Brain needed fewer requests than the plain reads (34 against 49, then 47 against 83) and cited more tightly.

Builder 2 changes three summaries. A folder without a README names its entries, a one-document folder by its document's title. A table names its rows. A retired document says so first. Searches also match every word on a line. With these changes the Brain sessions needed 40 to 41 requests instead of 47, finding the right unit without opening its look-alikes. Their tokens and their answers did not change beyond the spread between runs. One of the two runs wrote one answer line broken, which counts as unanswered. Citation precision varies with how a session cites (72% to 100%), more than with the builder.

## Wiki baseline

[ADR-0097](../decisions/0097-brain-indexes-wiki-pages.md) changes the Brain for wiki pages, and its decision 10 asks for the accuracy to be measured before a change is called an improvement. This baseline is the first step. It is deterministic and calls no model, so it can run on every change. It measures what the builder and the reads put within reach of an agent; it does not measure whether an agent uses them well (see [the agent-run baseline](#the-agent-run-baseline)).

**How it works.** `wiki-eval.ts` builds `fixture/wiki-docs/` with the domain's own `buildBrainTree` and answers each of the 23 questions the way a reader of the Brain can:

| Kind | Questions | How it is answered | Scores |
| --- | --- | --- | --- |
| `label` | W01-W03 | The pages whose node carries the label (an attribute of a later builder), and a `brain_grep` of the label word | Recall and precision of each, against the pages the front matter names |
| `space` | W04-W05 | The pages whose node carries the space key, and the pages under the space's folder | Recall and precision |
| `order` | W06-W08 | The order of the `brain_tree` children of a folder against the entries its home page lists in `order` | Share of listed entries in place |
| `retired`, `template` | W09, W10 | A summary that says "Archived" or starts `Template.`, and a status or template attribute | Recall and precision |
| `anchor`, `heading-link`, `moved` | W11-W13, W23 | The section anchors of a repeated heading, and whether a link to a heading or to a moved page reaches its node | Share found |
| `backlinks` | W14-W16 | The documents with a link to the page, from the stored links | Recall and precision |
| `broken` | W17 | The links the builder knows point nowhere | Recall and precision |
| `search` | W18-W20 | A `brain_grep` of the words: the lines that hold every word, case-insensitive, the first 50 | Recall and precision; the lines found are the cost |
| `descend` | W21-W22 | Every folder and document on the way down has a summary to follow | Share, and the tokens of the titles and summaries a reader passes |

Every question also names the lines that answer it by their text. The score `evidenceInNode` is the share of those lines a node holds, and the citation is that node's `path:start-end`. The test (`packages/agents/test/brain-eval.test.ts`) checks:

- the fixture is a wiki as ADR-0096 lays it out: free spaces with a home page that gives `key`, `title` and `order`, at least 15 pages with a page id of their space and labels, a page with children, an attachment a page links to, an alert, a macro block and a moved page;
- the key's answers are what the front matter and the links of the fixture say;
- every answer is in a node, with a citation that resolves to lines of its file;
- the Brain falls below no score of the baseline.

**The baseline.** Builder version 5, on `kcp-integration` a20bb69a (re-recorded by P2-016; the first recording, on b1d59f1c, predates the folder descriptions of the `20-spaces/` layout that P2-003 added to the summaries, so its two descend costs were 258 and 174). Produced by:

```bash
BRAIN_WIKI_BASELINE=1 BRAIN_WIKI_RECORDED="kcp-integration a20bb69a" pnpm --filter @kintsugi/agents exec vitest run test/brain-eval.test.ts
```

It writes `packages/agents/evals/brain/wiki-baseline.json`. Without the variable the same test compares the builder with that file: no score may be lower, and no cost more than a twentieth higher. The costs are counts of a deterministic build, so a cost that moves means a builder change: the descend costs add up the title and summary of every sibling on the way down, so any change to a folder or document summary moves them. Re-record the baseline in the commit that changes the summaries, and name that commit here.

| Measure | Builder 5 |
| --- | --- |
| Documents, nodes (folders, sections and cards) | 37, 109 (11, 60) |
| Nodes with a summary | 108 of 109 (everything but the root) |
| Links between pages or headings: resolved, unresolved | 18, 1 (`vpn-guide.md`, which does not exist) |
| Heading links resolved | 3 of 3 |
| Answer lines held by a node, with a citation | 33 of 33 (23 questions) |

| Questions | Builder 5 | Why |
| --- | --- | --- |
| W01-W03 labels | Found only by `brain_grep` of the word: recall 100%, precision 67%, 50% and 100% (3, 9 and 5 lines). No node carries the label | Labels are in front matter text only; ADR-0097 decision 1 puts them on the node |
| W04-W05 spaces | Found by the folder (100%); no node carries the space | A space is a folder; the `space` attribute is decision 1 |
| W06-W08 manual order | 0 of the listed entries first | Folders come first, then documents by name; decision 2 |
| W09 archived pages | Not told apart (0%) | `archived` is not among the status words that start a summary; decision 3 |
| W10 templates | Not told apart (0%) | A summary starting `Template.` is decision 3 |
| W11-W13, W23 anchors, heading links, a moved page | All 100%: a repeated heading is `overview` and `overview-1`, every heading link reaches its section | Builder 6 must keep them |
| W14-W16 backlinks | 100% from the stored links | Kept; decision 8 pages through them beyond 20 |
| W17 broken links | 0%: a link that resolves to nothing is dropped | `knowledge.brain_ref` keeps them (decision 6) |
| W18-W20 search | W18 and W19: 100% in one line each. W20 (the words "on-call lead"): recall 100%, precision 80%, because `owner: on-call-lead` lines match too | `brain_search` ranks them (decision 7) |
| W21-W22 descend | Every step has a summary; 4 and 3 levels, 286 and 193 tokens of titles and summaries to the answer | The cost builder 6 must not raise by more than a twentieth |

**What builder 6 must show.** No score below this table, and a gain on the questions that read 0: labels and spaces as node attributes (W01-W05), the listed order first (W06-W08), archived pages and templates told apart (W09, W10), the broken link listed (W17). The harness reads the new attributes from the node when they exist (`labels`, `space`, `status`, `template`) and `broken` from the tree, so the builder's change shows as a rise of the scores that now read 0, with no change to the questions.

### The agent-run baseline

The score above says what is within reach. Whether an agent finds it needs a live installation and a client session, and costs tokens. It is the owner's step, with the steps of [Run it](#run-it):

1. Push `fixture/wiki-docs/` as in step 1 there (`cp -r packages/agents/evals/brain/fixture/wiki-docs /path/to/wiki-docs`), register it as a project's document repository, give the member Project Access and build the Brain on `main`.
2. Open two fresh sessions of the same client and model with the Kintsugi MCP bridge connected: one may use the Brain tools, the other the plain document tools. Give each the 23 questions of `wiki-questions.json` (the `question` of each entry) and ask for one line of JSON per question: `{"id": "W01", "pages": ["path", ...], "citations": ["path:start-end@commit", ...]}`.
3. Compare each line with its entry: `pages` against `expect` (a recall and a precision per question, as above), and each citation against the lines the entry's `evidence` names (a citation is grounded when its lines overlap the line holding the text). Note the tool calls and tokens the client reports, and run each mode at least three times.
4. Record each run under [Recorded runs](#recorded-runs) with the builder version and the commit.

The scorer `brain_score.py` reads `questions.json` only. Teaching it the wiki key (`pages` instead of accepted values) belongs to the Phase 1 builder work, so that one command scores both fixtures.
