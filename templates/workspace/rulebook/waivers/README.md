# Waivers

A waiver lets a stage run although a required capability is not `ready`, for a limited scope and time.

- **One file per waiver**: `W-###.yaml`.
- **Approval**: approved by the rulebook `owners` in a PR.
- **Expiry**: enforced by Kintsugi.
- **Limit**: a `suspended` capability can never be waived.

Every run that relied on a waiver records its ID.
