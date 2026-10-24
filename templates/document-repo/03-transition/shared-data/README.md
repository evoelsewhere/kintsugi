# `03-transition/shared-data/`

- Written by: people (the data team), through review pull requests
- Serves: P2-P4; data several applications share
- Auto-commit: no — changes arrive as pull requests

One document per shared data definition: a master data entity, a reference code list or a common format that more than one application reads or writes (for example `customer-master.md`). Write it once here and refer to it from the applications' designs instead of copying it into each of them.

`customer-master.md.example` is the format. Copy it to a real name and adapt it.

## Index

| Document | Kind | Owner | Used by |
| --- | --- | --- | --- |
| <!-- `customer-master.md` --> | master data / reference codes / format | <!-- team --> | <!-- billing-web, crm --> |
