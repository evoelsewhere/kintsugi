# Billing application basic design

Status: approved design input for synthetic fixture revision A.

## Tax behavior

- Monetary values are integer minor units.
- Tax rates are integer basis points.
- Tax is computed once from the invoice taxable subtotal.
- The detailed unit design defines the approved rounding mode and boundary handling.
- The caller supplies the currency exponent; this fixture uses two decimal places.

## Scope

The invoice tax calculator is pure. It does not read a clock, call a provider or persist an invoice. Unsupported rates are rejected with a typed validation result.

## Decision record

Decision TAX-ROUND-01 is approved by maintainer in the synthetic fixture evidence manifest. Its authority is represented only by fixture metadata.
