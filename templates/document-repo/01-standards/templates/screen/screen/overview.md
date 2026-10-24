# {{unit.title}}: screen overview

## Purpose
<!--
required
guidance: One paragraph: what the user does on this screen, who the user is and what the legacy screen was.
check: no-placeholder
check: max-length(1500)
-->

## Users and access
<!--
required
table: Role | Access | Notes
guidance: Each role that may open the screen and what it may do there (view, edit, approve); the roles come from the unit's rules and the legacy security setup.
check: one-of(Access, view|edit|approve|none)
check: no-placeholder
-->

## Navigation
<!--
required
table: From | Action | To | Condition
guidance: How a user reaches the screen and where each action leads: the screens or menus on either side, the action that moves between them and the condition. A screen reached only from a menu has one row.
check: no-placeholder
-->

## Rule coverage
<!--
required
table: Rule | Handled by | Notes
seed: rules
guidance: Every business rule of the unit appears once; name the event (EVT-nnn, from events.md) or the validation (VAL-nnn) that applies it. A unit with no rules gets one row with - in each cell.
check: covers-rules(Rule)
check: no-placeholder
-->

## Open questions
<!--
table: Question | Raised by | Status
guidance: What the design could not settle; a rule marked clarify in its review goes here.
check: one-of(Status, open|answered|dropped)
-->
