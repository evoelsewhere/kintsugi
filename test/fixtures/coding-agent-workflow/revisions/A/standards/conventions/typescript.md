# TypeScript conventions for the synthetic billing project

Status: approved fixture standard.

- Use strict TypeScript and explicit return types for exported functions.
- Prefer integer arithmetic for money and percentages.
- Return typed validation failures for invalid external values.
- Keep the calculation pure and cover boundary behavior with tests.
