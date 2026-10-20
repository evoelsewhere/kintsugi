# Invoice tax calculation detailed design

Status: approved design input for synthetic fixture revision A.

## Inputs

The function accepts subtotalMinorUnits as a nonnegative integer, taxRateBasisPoints as an integer from 0 through 10000, and currencyExponent as an integer from 0 through 3.

## Calculation

Multiply the subtotal by the basis-point rate using integer arithmetic. Divide by 10000 and round the resulting tax to the nearest minor unit, with exact half values rounded away from zero. Apply rounding once to the invoice subtotal, not once per line.

## Output

Return subtotal, tax and total as integer minor units. Reject negative values, unsupported exponents and rates outside the declared range. Do not use binary floating point for the calculation.

## Boundary examples

- A zero tax rate returns zero tax.
- A subtotal that produces an exact half minor unit rounds upward.
- A subtotal that produces less than a half minor unit rounds downward.

## Approval basis

The synthetic evidence manifest binds this exact source revision to TAX-ROUND-01 and the maintainer fixture identity.
