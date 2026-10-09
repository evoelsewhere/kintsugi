# UI conventions

> Required before any screen is converted. No screen is converted while this file is at `template`.

## Design system / UI kit
- Component library and layout templates in the target base. Converted screens use only these.

## Interaction rules
- Validation messages, error states, empty states, loading, confirmation dialogs.

## Internationalization
- Resource files, date/number formats, supported locales.

## Project-level UX decisions
- Each modernization decision (e.g. menus → navigation, multi-window → tabs) is an ADR. Screens cite the ADR instead of deciding again.
