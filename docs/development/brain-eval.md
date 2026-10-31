# Brain eval

The eval measures how well a member's agent answers questions from a project's documents with the Brain, against the same agent with the plain document reads ([ADR-0091](../decisions/0091-brain-vectorless-tree-index.md) decision 8). It follows the approach of the [known-answer eval](known-answer-eval.md): a fixture whose answers are known, an answer key and a deterministic scorer. It lives in `packages/agents/evals/brain/`:

| Path | What it is |
| --- | --- |
| `fixture/shop-docs/` | A document repository of 59 Markdown documents in the numbered layout. It plants answers in several kinds of places: two and three levels down, in cards with ids, in tables, and behind a common component and a decision. It has rules with a near twin in another application, a decision superseded by a later one, and a 30,000-character document longer than one read. It also has a term that no title or summary shows, questions it does not answer, and an instruction addressed to AI assistants |
| `make_scale.py` | Writes the large part of the fixture: two legacy applications of 30 look-alike units with program-like names (`rtn04`, `ship03`), three rule cards each. A few hold answers worded differently from the questions |
| `questions.json` | The 28 questions, the lines that answer each (by the text of the line, never by number), the accepted values, and the phrases and patterns that say "the documents do not answer" |
| `brain_score.py` | The scorer of one or more runs, and the prompt for a run (`--prompt`) |
| `tests/` | The scorer's tests, the check that the key fits the fixture, and the check that the large part is what `make_scale.py` writes |

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
