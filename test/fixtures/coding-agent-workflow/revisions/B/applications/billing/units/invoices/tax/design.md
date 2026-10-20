# Invoice tax calculation detailed design

Status: changed source in synthetic revision B; the new content is awaiting approval.

## Inputs

The function accepts subtotalMinorUnits, taxRateBasisPoints and a currencyExponent with the same validation bounds as revision A.

## Changed calculation

Revision B proposes rounding each invoice line before summing tax. This differs from revision A, which rounds once from the invoice subtotal. The content hash and context revision must change. Approval for revision A must not carry forward.

## Output

Return subtotal, tax and total as integer minor units. Do not use binary floating point for money.
