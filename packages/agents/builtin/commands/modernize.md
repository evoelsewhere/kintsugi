---
description: Start here — say what you want done with your code and get the plan and the first step
argument-hint: [app]
arguments: app
metadata:
  audience: portal
  upstream: commands/modernize.md
  agents: []
  reads: [kintsugi.yaml, assessment/<app>/]
  writes: [assessment/<app>/INTENT.md]
  gates: [the person confirms the goal and target before INTENT.md is written, the person starts the first stage]
---

**The portal implements this command** as its "start a modernization" wizard. The content below is the
specification of what the wizard asks, what it shows and what the worker writes; nothing here runs as a runtime
job or in a member's harness. Every file the wizard records is committed to the document repository by the
worker as `kintsugi-bot`, with a `Kintsugi-Actor: <user>` trailer naming the person who answered.

You are the front door of a guided modernization. The person may know nothing about modernization: ask
little, explain in plain words, and always end on one exact next step to start.

## 1 — Find where things stand

- If `$app` was given, use it. Otherwise look at the applications in `kintsugi.yaml` and at `assessment/`: one
  application means use it, several means ask which (a choice in the wizard), none means the project has no
  application yet: say so and point to registering one (step 2).
- If `assessment/$app/` already has files, this is a return visit: show what the progress view (the `status`
  specification) shows (where they are, what is stale) in five lines, and end on the exact next step. Stop there.

## 2 — Pick the application and its legacy repository

Kintsugi already knows where the code is: each application in `kintsugi.yaml` lists its registered repositories,
and the ones with `role: legacy` hold the legacy code (read-only for the runtime and for members). Nothing is ever
copied, linked or cloned by this wizard.

- Show the application's legacy repositories (Git server and path). One means use it; several means ask which one
  this modernization covers (or all of them). None means the application cannot start yet: say so and point to
  registering a legacy repository on the application.
- Read the legacy repository at its current default-branch commit and record that commit: every later stage says
  which commit it read.
- Say in one line what you found there (languages and rough size: a file count by extension is enough; the portal
  can take it from the repository index or from a script step).

## 3 — Ask what they want (two short questions at most)

Ask in the wizard, as structured choices, never as free chat text; when the wizard is driven without a person (an
automated start through the API) pick the defaults and record them as open items in `INTENT.md`. A question allows
at most four options, and the person can always type their own answer.

**Question set 1, two questions:**

1. **What do you want to do with it?** *Move to a newer version of the same technology* (for example .NET Framework to
   .NET 8, Java 8 to 17, Python 2 to 3), *Rewrite it in a different technology, one piece at a time, while the old system
   keeps running*, *Rebuild it from scratch on a new architecture*, *Understand it first: map it and list what it does*
   (also the right choice when they are not sure: the assessment then recommends one of the other three).
2. **What must stay true?** Pick any: *The old system keeps running during the move*, *Behavior must match exactly,
   including known quirks*, *Fix known bugs as we go*, *A security review comes first*. Choosing none means nothing
   special.

**Question set 2, one question, only after the first answer and never for "understand it first":** *What should it become?*
Tailor it to what you found in step 2: for a version move, the newest supported versions of the code's stack ("Java
21", "Java 17"); for a rewrite, two or three common target technologies for this kind of code; for a rebuild, the
architecture options that fit (a REST API with a separate front end, a few services, a modular monolith). The person
can type any other target.

## 4 — Write it down once

The worker writes `assessment/$app/INTENT.md`: the goal (uplift, transform, reimagine or understand), from and to (or the target
and vision), what must stay true, the legacy repository and commit read in step 2, who answered, and today's date, with their answers word for word. Later stages read it so nobody
is asked twice: `brief` takes its target stack from it and never overrides it with a guess.

## 5 — Show the road

In at most eight lines, tailored to their goal, list the stages they will go through in order (`preflight`, `assess`, `map`,
`extract-rules`, `review` when rules are flagged for a person, `brief`, then `uplift`, `transform` or `reimagine`, then `verify` and `harden`), one line each on what they get
and where a person decides. For "understand it first" stop after `brief`. For "not sure", run `preflight` and `assess`
first and let the assessment's recommended pattern pick the road. Name the places a person decides (the preflight answers, the rules that look wrong, approving the brief, accepting each difference the proof finds, signing the proof, applying the security patch) so nothing surprises them; in the portal each one is a task or a gate. If they chose *A security review comes first*, put `harden` right after `assess`, before any build.

## 6 — First step

Show the first step with everything filled in, for example the `preflight` stage for `billing` with target "Java 17":
its five questions become a portal task for the person, and its build checks a task for the member who builds the
code. Ask "Shall I start it?". On yes (or for an automated start), start the `preflight` stage with those arguments
as if they had chosen it from the progress view. After it finishes, name the next step.
