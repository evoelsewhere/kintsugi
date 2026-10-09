# Vendored rulebooks

Snapshots of external rulebooks or packs listed under `extends` in `rulebook.yaml`, stored as `vendor/<id>@<version>/`.

- **Do not edit** files here. Override them in `packs/` or `overrides/` instead.
- **Upgrade** with `kintsugi rulebook upgrade <id> --to <version>`. It opens a PR that shows the diff, resets changed capabilities to `draft`, and marks affected units `stale`.
- **Maturity** declared inside vendored content is ignored. The project declares its own under `extends[].capabilities`.
