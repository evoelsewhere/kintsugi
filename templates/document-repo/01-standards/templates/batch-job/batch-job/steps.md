# {{unit.title}}: steps

## Steps
<!--
required
table: ID | Action | Reads | Writes | Rules | Commit unit
guidance: The processing steps in order; ids look like STEP-01 and never change once written. Say what each does in one precise sentence, name what it reads and writes, cite the business rules it applies (or -) and say when its work is committed (once, every N records, with another step).
check: id-pattern(ID, STEP-[0-9]{2})
check: refs-resolve(Rules -> rules)
check: no-placeholder
-->

## Restart and error handling
<!--
required
table: Code | Step | Condition | Message | Restart
guidance: Each error the job can raise: a code of the form ERR-0001, the step (STEP-nn) it occurs in, when it is raised, the message logged and exactly what a restart does after it (resume at the failed record, redo the step, nothing to redo).
check: id-pattern(Code, ERR-[0-9]{4})
check: id-pattern(Step, STEP-[0-9]{2})
check: no-placeholder
-->

## Common components used
<!--
table: Component | Use
guidance: The common components (COM-..., from 02-architecture/common/) the job calls and for what.
check: refs-resolve(Component -> components)
-->
