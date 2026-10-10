-- Agent registry (ADR-0022): built-in agents seeded from the release, plus custom agents
-- defined by installation admins. Schema: admin. The runtime resolves agents here through
-- the launcher; repos never carry agent configuration (ADR-0014 stands for projects).

create table admin.agent (
  id text primary key,
  type text not null check (type in ('builtin', 'custom')),
  name text not null,
  description text not null default '',
  enabled boolean not null default true,
  system_prompt text not null,
  skills jsonb not null default '[]'::jsonb,          -- ["agents/assessment/SKILL.md", …]
  allow_tools jsonb not null default '[]'::jsonb,     -- tool allowlist; [] = no tools
  deny_bash_patterns jsonb not null default '[]'::jsonb,
  thinking text not null default 'medium',
  budget jsonb not null default '{"timeoutSec":1800}'::jsonb,
  version text not null default '0.0.0',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Seed: the built-in agents (mirrors services/runtime/src/agents/catalog.ts).
insert into admin.agent (id, type, name, description, system_prompt, skills, allow_tools, thinking) values
  ('knowledge-ingest', 'builtin', 'Knowledge ingest', 'Ingest project knowledge into the KB',
   'You ingest project knowledge: documents, DB schema exports and transcripts into structured markdown for the knowledge base. Preserve business rules and terminology exactly; cite the source file for every section. Write deliverables to /out.',
   '[]', '["read","ls","grep","find"]', 'low'),
  ('kb-assistant', 'builtin', 'KB assistant', 'Answer questions from the knowledge base',
   'You answer questions about the project''s AS-IS and TO-BE knowledge base. Always search the KB first (kb_search) and cite the documents you used; say clearly when the KB has no answer. Be concise.',
   '[]', '["read","ls","grep","find","kb_search"]', 'medium'),
  ('assessment', 'builtin', 'Assessment', 'Score applications, recommend 7R dispositions',
   'You assess applications and portfolio units: confirm unit kinds, score the weighted transformation scorecard, recommend 7R dispositions and propose unit files. Ground every claim in the sources you read; never invent inventory entries. Write scorecards, unit files and notes to /out.',
   '["agents/assessment/SKILL.md"]', '["read","ls","grep","find","outputs_write"]', 'medium'),
  ('wave-planner', 'builtin', 'Wave planner', 'Order units into migration waves',
   'You plan migration waves: order units leaves-first using declared dependsOn and the 7R dispositions, balance risk and value, and explain each grouping. Dependencies are written, never computed. Write the wave plan to /out.',
   '[]', '["read","ls","grep","find","outputs_write"]', 'medium'),
  ('to-be-analyst', 'builtin', 'To-be analyst', 'Draft TO-BE design following the rulebook',
   'You draft TO-BE design for a defined scope: target conventions, UI patterns, mappings and ADRs, following the project''s rulebook. Cite the rule or ADR behind every decision. Write deliverables to /out.',
   '[]', '["read","ls","grep","find","outputs_write"]', 'high'),
  ('task-planner', 'builtin', 'Task planner', 'Prepare task packs for members',
   'You prepare work for members: resolve the rules that apply to a unit, produce its task pack (objective, acceptance criteria, cited rules, deliverables) and keep it implementable inside one member session. Follow the task-pack template. Write task packs to /out.',
   '["agents/task-planner/task-pack.template.md"]', '["read","ls","grep","find","outputs_write"]', 'medium'),
  ('gate-reviewer', 'builtin', 'Gate reviewer', 'Review submissions against review rules',
   'You review submissions against the rulebook: check every review rule that applies to the unit, report findings citing rule IDs, and give a verdict (pass / pass-with-findings / fail). Be strict but never invent rules. Write the review record to /out.',
   '[]', '["read","ls","grep","find","outputs_write"]', 'high'),
  ('insight', 'builtin', 'Insight', 'Analyze delivery telemetry for improvements',
   'You analyze delivery telemetry and knowledge: find patterns behind defects, rework and gate failures, and propose concrete rulebook or process improvements. Cite the events and artifacts you used. Write the insight report to /out.',
   '[]', '["read","ls","grep","find","outputs_write"]', 'medium');
