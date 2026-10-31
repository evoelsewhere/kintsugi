# API catalog

Every operation the new order services expose, grouped by area. Paths are relative to the service's base URL.

## Orders

The operations of the orders area.

| Method | Path | What it does |
| --- | --- | --- |
| GET | `/orders` | Lists the orders of the caller's stores, newest first, 50 per page |
| GET | `/orders/{id}` | Returns one orders record with its history |
| POST | `/orders` | Creates a orders record; the body is validated against the orders schema |
| PATCH | `/orders/{id}` | Changes the fields of one orders record that are still open |
| DELETE | `/orders/{id}` | Withdraws one orders record; it stays readable for audit |
| GET | `/orders/{id}/history` | Lists the changes of one orders record with who made them |
| POST | `/orders/{id}/comments` | Adds a comment to one orders record for the support team |
| GET | `/order-lines` | Lists the order lines of the caller's stores, newest first, 50 per page |
| GET | `/order-lines/{id}` | Returns one order lines record with its history |
| POST | `/order-lines` | Creates a order lines record; the body is validated against the order lines schema |
| PATCH | `/order-lines/{id}` | Changes the fields of one order lines record that are still open |
| DELETE | `/order-lines/{id}` | Withdraws one order lines record; it stays readable for audit |
| GET | `/order-lines/{id}/history` | Lists the changes of one order lines record with who made them |
| POST | `/order-lines/{id}/comments` | Adds a comment to one order lines record for the support team |
| GET | `/order-notes` | Lists the order notes of the caller's stores, newest first, 50 per page |
| GET | `/order-notes/{id}` | Returns one order notes record with its history |
| POST | `/order-notes` | Creates a order notes record; the body is validated against the order notes schema |
| PATCH | `/order-notes/{id}` | Changes the fields of one order notes record that are still open |
| DELETE | `/order-notes/{id}` | Withdraws one order notes record; it stays readable for audit |
| GET | `/order-notes/{id}/history` | Lists the changes of one order notes record with who made them |
| POST | `/order-notes/{id}/comments` | Adds a comment to one order notes record for the support team |
| GET | `/order-holds` | Lists the order holds of the caller's stores, newest first, 50 per page |
| GET | `/order-holds/{id}` | Returns one order holds record with its history |
| POST | `/order-holds` | Creates a order holds record; the body is validated against the order holds schema |
| PATCH | `/order-holds/{id}` | Changes the fields of one order holds record that are still open |
| DELETE | `/order-holds/{id}` | Withdraws one order holds record; it stays readable for audit |
| GET | `/order-holds/{id}/history` | Lists the changes of one order holds record with who made them |
| POST | `/order-holds/{id}/comments` | Adds a comment to one order holds record for the support team |
| GET | `/order-returns` | Lists the order returns of the caller's stores, newest first, 50 per page |
| GET | `/order-returns/{id}` | Returns one order returns record with its history |
| POST | `/order-returns` | Creates a order returns record; the body is validated against the order returns schema |
| PATCH | `/order-returns/{id}` | Changes the fields of one order returns record that are still open |
| DELETE | `/order-returns/{id}` | Withdraws one order returns record; it stays readable for audit |
| GET | `/order-returns/{id}/history` | Lists the changes of one order returns record with who made them |
| POST | `/order-returns/{id}/comments` | Adds a comment to one order returns record for the support team |
| GET | `/order-cancellations` | Lists the order cancellations of the caller's stores, newest first, 50 per page |
| GET | `/order-cancellations/{id}` | Returns one order cancellations record with its history |
| POST | `/order-cancellations` | Creates a order cancellations record; the body is validated against the order cancellations schema |
| PATCH | `/order-cancellations/{id}` | Changes the fields of one order cancellations record that are still open |
| DELETE | `/order-cancellations/{id}` | Withdraws one order cancellations record; it stays readable for audit |
| GET | `/order-cancellations/{id}/history` | Lists the changes of one order cancellations record with who made them |
| POST | `/order-cancellations/{id}/comments` | Adds a comment to one order cancellations record for the support team |
| GET | `/order-addresses` | Lists the order addresses of the caller's stores, newest first, 50 per page |
| GET | `/order-addresses/{id}` | Returns one order addresses record with its history |
| POST | `/order-addresses` | Creates a order addresses record; the body is validated against the order addresses schema |
| PATCH | `/order-addresses/{id}` | Changes the fields of one order addresses record that are still open |
| DELETE | `/order-addresses/{id}` | Withdraws one order addresses record; it stays readable for audit |
| GET | `/order-addresses/{id}/history` | Lists the changes of one order addresses record with who made them |
| POST | `/order-addresses/{id}/comments` | Adds a comment to one order addresses record for the support team |
| GET | `/order-payments` | Lists the order payments of the caller's stores, newest first, 50 per page |
| GET | `/order-payments/{id}` | Returns one order payments record with its history |
| POST | `/order-payments` | Creates a order payments record; the body is validated against the order payments schema |
| PATCH | `/order-payments/{id}` | Changes the fields of one order payments record that are still open |
| DELETE | `/order-payments/{id}` | Withdraws one order payments record; it stays readable for audit |
| GET | `/order-payments/{id}/history` | Lists the changes of one order payments record with who made them |
| POST | `/order-payments/{id}/comments` | Adds a comment to one order payments record for the support team |
| GET | `/order-shipments` | Lists the order shipments of the caller's stores, newest first, 50 per page |
| GET | `/order-shipments/{id}` | Returns one order shipments record with its history |
| POST | `/order-shipments` | Creates a order shipments record; the body is validated against the order shipments schema |
| PATCH | `/order-shipments/{id}` | Changes the fields of one order shipments record that are still open |
| DELETE | `/order-shipments/{id}` | Withdraws one order shipments record; it stays readable for audit |
| GET | `/order-shipments/{id}/history` | Lists the changes of one order shipments record with who made them |
| POST | `/order-shipments/{id}/comments` | Adds a comment to one order shipments record for the support team |
| GET | `/order-events` | Lists the order events of the caller's stores, newest first, 50 per page |
| GET | `/order-events/{id}` | Returns one order events record with its history |
| POST | `/order-events` | Creates a order events record; the body is validated against the order events schema |
| PATCH | `/order-events/{id}` | Changes the fields of one order events record that are still open |
| DELETE | `/order-events/{id}` | Withdraws one order events record; it stays readable for audit |
| GET | `/order-events/{id}/history` | Lists the changes of one order events record with who made them |
| POST | `/order-events/{id}/comments` | Adds a comment to one order events record for the support team |
| GET | `/order-tags` | Lists the order tags of the caller's stores, newest first, 50 per page |
| GET | `/order-tags/{id}` | Returns one order tags record with its history |
| POST | `/order-tags` | Creates a order tags record; the body is validated against the order tags schema |
| PATCH | `/order-tags/{id}` | Changes the fields of one order tags record that are still open |
| DELETE | `/order-tags/{id}` | Withdraws one order tags record; it stays readable for audit |
| GET | `/order-tags/{id}/history` | Lists the changes of one order tags record with who made them |
| POST | `/order-tags/{id}/comments` | Adds a comment to one order tags record for the support team |
| GET | `/order-attachments` | Lists the order attachments of the caller's stores, newest first, 50 per page |
| GET | `/order-attachments/{id}` | Returns one order attachments record with its history |
| POST | `/order-attachments` | Creates a order attachments record; the body is validated against the order attachments schema |
| PATCH | `/order-attachments/{id}` | Changes the fields of one order attachments record that are still open |
| DELETE | `/order-attachments/{id}` | Withdraws one order attachments record; it stays readable for audit |
| GET | `/order-attachments/{id}/history` | Lists the changes of one order attachments record with who made them |
| POST | `/order-attachments/{id}/comments` | Adds a comment to one order attachments record for the support team |

## Pricing

The operations of the pricing area.

| Method | Path | What it does |
| --- | --- | --- |
| GET | `/price-lists` | Lists the price lists of the caller's stores, newest first, 50 per page |
| GET | `/price-lists/{id}` | Returns one price lists record with its history |
| POST | `/price-lists` | Creates a price lists record; the body is validated against the price lists schema |
| PATCH | `/price-lists/{id}` | Changes the fields of one price lists record that are still open |
| DELETE | `/price-lists/{id}` | Withdraws one price lists record; it stays readable for audit |
| GET | `/price-lists/{id}/history` | Lists the changes of one price lists record with who made them |
| POST | `/price-lists/{id}/comments` | Adds a comment to one price lists record for the support team |
| GET | `/price-rules` | Lists the price rules of the caller's stores, newest first, 50 per page |
| GET | `/price-rules/{id}` | Returns one price rules record with its history |
| POST | `/price-rules` | Creates a price rules record; the body is validated against the price rules schema |
| PATCH | `/price-rules/{id}` | Changes the fields of one price rules record that are still open |
| DELETE | `/price-rules/{id}` | Withdraws one price rules record; it stays readable for audit |
| GET | `/price-rules/{id}/history` | Lists the changes of one price rules record with who made them |
| POST | `/price-rules/{id}/comments` | Adds a comment to one price rules record for the support team |
| GET | `/discounts` | Lists the discounts of the caller's stores, newest first, 50 per page |
| GET | `/discounts/{id}` | Returns one discounts record with its history |
| POST | `/discounts` | Creates a discounts record; the body is validated against the discounts schema |
| PATCH | `/discounts/{id}` | Changes the fields of one discounts record that are still open |
| DELETE | `/discounts/{id}` | Withdraws one discounts record; it stays readable for audit |
| GET | `/discounts/{id}/history` | Lists the changes of one discounts record with who made them |
| POST | `/discounts/{id}/comments` | Adds a comment to one discounts record for the support team |
| GET | `/surcharges` | Lists the surcharges of the caller's stores, newest first, 50 per page |
| GET | `/surcharges/{id}` | Returns one surcharges record with its history |
| POST | `/surcharges` | Creates a surcharges record; the body is validated against the surcharges schema |
| PATCH | `/surcharges/{id}` | Changes the fields of one surcharges record that are still open |
| DELETE | `/surcharges/{id}` | Withdraws one surcharges record; it stays readable for audit |
| GET | `/surcharges/{id}/history` | Lists the changes of one surcharges record with who made them |
| POST | `/surcharges/{id}/comments` | Adds a comment to one surcharges record for the support team |
| GET | `/tax-codes` | Lists the tax codes of the caller's stores, newest first, 50 per page |
| GET | `/tax-codes/{id}` | Returns one tax codes record with its history |
| POST | `/tax-codes` | Creates a tax codes record; the body is validated against the tax codes schema |
| PATCH | `/tax-codes/{id}` | Changes the fields of one tax codes record that are still open |
| DELETE | `/tax-codes/{id}` | Withdraws one tax codes record; it stays readable for audit |
| GET | `/tax-codes/{id}/history` | Lists the changes of one tax codes record with who made them |
| POST | `/tax-codes/{id}/comments` | Adds a comment to one tax codes record for the support team |
| GET | `/currencies` | Lists the currencies of the caller's stores, newest first, 50 per page |
| GET | `/currencies/{id}` | Returns one currencies record with its history |
| POST | `/currencies` | Creates a currencies record; the body is validated against the currencies schema |
| PATCH | `/currencies/{id}` | Changes the fields of one currencies record that are still open |
| DELETE | `/currencies/{id}` | Withdraws one currencies record; it stays readable for audit |
| GET | `/currencies/{id}/history` | Lists the changes of one currencies record with who made them |
| POST | `/currencies/{id}/comments` | Adds a comment to one currencies record for the support team |
| GET | `/promotions` | Lists the promotions of the caller's stores, newest first, 50 per page |
| GET | `/promotions/{id}` | Returns one promotions record with its history |
| POST | `/promotions` | Creates a promotions record; the body is validated against the promotions schema |
| PATCH | `/promotions/{id}` | Changes the fields of one promotions record that are still open |
| DELETE | `/promotions/{id}` | Withdraws one promotions record; it stays readable for audit |
| GET | `/promotions/{id}/history` | Lists the changes of one promotions record with who made them |
| POST | `/promotions/{id}/comments` | Adds a comment to one promotions record for the support team |
| GET | `/vouchers` | Lists the vouchers of the caller's stores, newest first, 50 per page |
| GET | `/vouchers/{id}` | Returns one vouchers record with its history |
| POST | `/vouchers` | Creates a vouchers record; the body is validated against the vouchers schema |
| PATCH | `/vouchers/{id}` | Changes the fields of one vouchers record that are still open |
| DELETE | `/vouchers/{id}` | Withdraws one vouchers record; it stays readable for audit |
| GET | `/vouchers/{id}/history` | Lists the changes of one vouchers record with who made them |
| POST | `/vouchers/{id}/comments` | Adds a comment to one vouchers record for the support team |

## Invoices

The operations of the invoices area.

| Method | Path | What it does |
| --- | --- | --- |
| GET | `/invoices` | Lists the invoices of the caller's stores, newest first, 50 per page |
| GET | `/invoices/{id}` | Returns one invoices record with its history |
| POST | `/invoices` | Creates a invoices record; the body is validated against the invoices schema |
| PATCH | `/invoices/{id}` | Changes the fields of one invoices record that are still open |
| DELETE | `/invoices/{id}` | Withdraws one invoices record; it stays readable for audit |
| GET | `/invoices/{id}/history` | Lists the changes of one invoices record with who made them |
| POST | `/invoices/{id}/comments` | Adds a comment to one invoices record for the support team |
| GET | `/invoice-lines` | Lists the invoice lines of the caller's stores, newest first, 50 per page |
| GET | `/invoice-lines/{id}` | Returns one invoice lines record with its history |
| POST | `/invoice-lines` | Creates a invoice lines record; the body is validated against the invoice lines schema |
| PATCH | `/invoice-lines/{id}` | Changes the fields of one invoice lines record that are still open |
| DELETE | `/invoice-lines/{id}` | Withdraws one invoice lines record; it stays readable for audit |
| GET | `/invoice-lines/{id}/history` | Lists the changes of one invoice lines record with who made them |
| POST | `/invoice-lines/{id}/comments` | Adds a comment to one invoice lines record for the support team |
| GET | `/credit-notes` | Lists the credit notes of the caller's stores, newest first, 50 per page |
| GET | `/credit-notes/{id}` | Returns one credit notes record with its history |
| POST | `/credit-notes` | Creates a credit notes record; the body is validated against the credit notes schema |
| PATCH | `/credit-notes/{id}` | Changes the fields of one credit notes record that are still open |
| DELETE | `/credit-notes/{id}` | Withdraws one credit notes record; it stays readable for audit |
| GET | `/credit-notes/{id}/history` | Lists the changes of one credit notes record with who made them |
| POST | `/credit-notes/{id}/comments` | Adds a comment to one credit notes record for the support team |
| GET | `/payment-terms` | Lists the payment terms of the caller's stores, newest first, 50 per page |
| GET | `/payment-terms/{id}` | Returns one payment terms record with its history |
| POST | `/payment-terms` | Creates a payment terms record; the body is validated against the payment terms schema |
| PATCH | `/payment-terms/{id}` | Changes the fields of one payment terms record that are still open |
| DELETE | `/payment-terms/{id}` | Withdraws one payment terms record; it stays readable for audit |
| GET | `/payment-terms/{id}/history` | Lists the changes of one payment terms record with who made them |
| POST | `/payment-terms/{id}/comments` | Adds a comment to one payment terms record for the support team |
| GET | `/invoice-runs` | Lists the invoice runs of the caller's stores, newest first, 50 per page |
| GET | `/invoice-runs/{id}` | Returns one invoice runs record with its history |
| POST | `/invoice-runs` | Creates a invoice runs record; the body is validated against the invoice runs schema |
| PATCH | `/invoice-runs/{id}` | Changes the fields of one invoice runs record that are still open |
| DELETE | `/invoice-runs/{id}` | Withdraws one invoice runs record; it stays readable for audit |
| GET | `/invoice-runs/{id}/history` | Lists the changes of one invoice runs record with who made them |
| POST | `/invoice-runs/{id}/comments` | Adds a comment to one invoice runs record for the support team |
| GET | `/invoice-templates` | Lists the invoice templates of the caller's stores, newest first, 50 per page |
| GET | `/invoice-templates/{id}` | Returns one invoice templates record with its history |
| POST | `/invoice-templates` | Creates a invoice templates record; the body is validated against the invoice templates schema |
| PATCH | `/invoice-templates/{id}` | Changes the fields of one invoice templates record that are still open |
| DELETE | `/invoice-templates/{id}` | Withdraws one invoice templates record; it stays readable for audit |
| GET | `/invoice-templates/{id}/history` | Lists the changes of one invoice templates record with who made them |
| POST | `/invoice-templates/{id}/comments` | Adds a comment to one invoice templates record for the support team |
| GET | `/invoice-exports` | Lists the invoice exports of the caller's stores, newest first, 50 per page |
| GET | `/invoice-exports/{id}` | Returns one invoice exports record with its history |
| POST | `/invoice-exports` | Creates a invoice exports record; the body is validated against the invoice exports schema |
| PATCH | `/invoice-exports/{id}` | Changes the fields of one invoice exports record that are still open |
| DELETE | `/invoice-exports/{id}` | Withdraws one invoice exports record; it stays readable for audit |
| GET | `/invoice-exports/{id}/history` | Lists the changes of one invoice exports record with who made them |
| POST | `/invoice-exports/{id}/comments` | Adds a comment to one invoice exports record for the support team |
| GET | `/invoice-corrections` | Lists the invoice corrections of the caller's stores, newest first, 50 per page |
| GET | `/invoice-corrections/{id}` | Returns one invoice corrections record with its history |
| POST | `/invoice-corrections` | Creates a invoice corrections record; the body is validated against the invoice corrections schema |
| PATCH | `/invoice-corrections/{id}` | Changes the fields of one invoice corrections record that are still open |
| DELETE | `/invoice-corrections/{id}` | Withdraws one invoice corrections record; it stays readable for audit |
| GET | `/invoice-corrections/{id}/history` | Lists the changes of one invoice corrections record with who made them |
| POST | `/invoice-corrections/{id}/comments` | Adds a comment to one invoice corrections record for the support team |
| GET | `/invoice-holds` | Lists the invoice holds of the caller's stores, newest first, 50 per page |
| GET | `/invoice-holds/{id}` | Returns one invoice holds record with its history |
| POST | `/invoice-holds` | Creates a invoice holds record; the body is validated against the invoice holds schema |
| PATCH | `/invoice-holds/{id}` | Changes the fields of one invoice holds record that are still open |
| DELETE | `/invoice-holds/{id}` | Withdraws one invoice holds record; it stays readable for audit |
| GET | `/invoice-holds/{id}/history` | Lists the changes of one invoice holds record with who made them |
| POST | `/invoice-holds/{id}/comments` | Adds a comment to one invoice holds record for the support team |
| GET | `/invoice-events` | Lists the invoice events of the caller's stores, newest first, 50 per page |
| GET | `/invoice-events/{id}` | Returns one invoice events record with its history |
| POST | `/invoice-events` | Creates a invoice events record; the body is validated against the invoice events schema |
| PATCH | `/invoice-events/{id}` | Changes the fields of one invoice events record that are still open |
| DELETE | `/invoice-events/{id}` | Withdraws one invoice events record; it stays readable for audit |
| GET | `/invoice-events/{id}/history` | Lists the changes of one invoice events record with who made them |
| POST | `/invoice-events/{id}/comments` | Adds a comment to one invoice events record for the support team |

## Customers

The operations of the customers area.

| Method | Path | What it does |
| --- | --- | --- |
| GET | `/customers` | Lists the customers of the caller's stores, newest first, 50 per page |
| GET | `/customers/{id}` | Returns one customers record with its history |
| POST | `/customers` | Creates a customers record; the body is validated against the customers schema |
| PATCH | `/customers/{id}` | Changes the fields of one customers record that are still open |
| DELETE | `/customers/{id}` | Withdraws one customers record; it stays readable for audit |
| GET | `/customers/{id}/history` | Lists the changes of one customers record with who made them |
| POST | `/customers/{id}/comments` | Adds a comment to one customers record for the support team |
| GET | `/customer-addresses` | Lists the customer addresses of the caller's stores, newest first, 50 per page |
| GET | `/customer-addresses/{id}` | Returns one customer addresses record with its history |
| POST | `/customer-addresses` | Creates a customer addresses record; the body is validated against the customer addresses schema |
| PATCH | `/customer-addresses/{id}` | Changes the fields of one customer addresses record that are still open |
| DELETE | `/customer-addresses/{id}` | Withdraws one customer addresses record; it stays readable for audit |
| GET | `/customer-addresses/{id}/history` | Lists the changes of one customer addresses record with who made them |
| POST | `/customer-addresses/{id}/comments` | Adds a comment to one customer addresses record for the support team |
| GET | `/customer-contacts` | Lists the customer contacts of the caller's stores, newest first, 50 per page |
| GET | `/customer-contacts/{id}` | Returns one customer contacts record with its history |
| POST | `/customer-contacts` | Creates a customer contacts record; the body is validated against the customer contacts schema |
| PATCH | `/customer-contacts/{id}` | Changes the fields of one customer contacts record that are still open |
| DELETE | `/customer-contacts/{id}` | Withdraws one customer contacts record; it stays readable for audit |
| GET | `/customer-contacts/{id}/history` | Lists the changes of one customer contacts record with who made them |
| POST | `/customer-contacts/{id}/comments` | Adds a comment to one customer contacts record for the support team |
| GET | `/customer-tiers` | Lists the customer tiers of the caller's stores, newest first, 50 per page |
| GET | `/customer-tiers/{id}` | Returns one customer tiers record with its history |
| POST | `/customer-tiers` | Creates a customer tiers record; the body is validated against the customer tiers schema |
| PATCH | `/customer-tiers/{id}` | Changes the fields of one customer tiers record that are still open |
| DELETE | `/customer-tiers/{id}` | Withdraws one customer tiers record; it stays readable for audit |
| GET | `/customer-tiers/{id}/history` | Lists the changes of one customer tiers record with who made them |
| POST | `/customer-tiers/{id}/comments` | Adds a comment to one customer tiers record for the support team |
| GET | `/customer-limits` | Lists the customer limits of the caller's stores, newest first, 50 per page |
| GET | `/customer-limits/{id}` | Returns one customer limits record with its history |
| POST | `/customer-limits` | Creates a customer limits record; the body is validated against the customer limits schema |
| PATCH | `/customer-limits/{id}` | Changes the fields of one customer limits record that are still open |
| DELETE | `/customer-limits/{id}` | Withdraws one customer limits record; it stays readable for audit |
| GET | `/customer-limits/{id}/history` | Lists the changes of one customer limits record with who made them |
| POST | `/customer-limits/{id}/comments` | Adds a comment to one customer limits record for the support team |
| GET | `/customer-notes` | Lists the customer notes of the caller's stores, newest first, 50 per page |
| GET | `/customer-notes/{id}` | Returns one customer notes record with its history |
| POST | `/customer-notes` | Creates a customer notes record; the body is validated against the customer notes schema |
| PATCH | `/customer-notes/{id}` | Changes the fields of one customer notes record that are still open |
| DELETE | `/customer-notes/{id}` | Withdraws one customer notes record; it stays readable for audit |
| GET | `/customer-notes/{id}/history` | Lists the changes of one customer notes record with who made them |
| POST | `/customer-notes/{id}/comments` | Adds a comment to one customer notes record for the support team |
| GET | `/customer-consents` | Lists the customer consents of the caller's stores, newest first, 50 per page |
| GET | `/customer-consents/{id}` | Returns one customer consents record with its history |
| POST | `/customer-consents` | Creates a customer consents record; the body is validated against the customer consents schema |
| PATCH | `/customer-consents/{id}` | Changes the fields of one customer consents record that are still open |
| DELETE | `/customer-consents/{id}` | Withdraws one customer consents record; it stays readable for audit |
| GET | `/customer-consents/{id}/history` | Lists the changes of one customer consents record with who made them |
| POST | `/customer-consents/{id}/comments` | Adds a comment to one customer consents record for the support team |
| GET | `/customer-merges` | Lists the customer merges of the caller's stores, newest first, 50 per page |
| GET | `/customer-merges/{id}` | Returns one customer merges record with its history |
| POST | `/customer-merges` | Creates a customer merges record; the body is validated against the customer merges schema |
| PATCH | `/customer-merges/{id}` | Changes the fields of one customer merges record that are still open |
| DELETE | `/customer-merges/{id}` | Withdraws one customer merges record; it stays readable for audit |
| GET | `/customer-merges/{id}/history` | Lists the changes of one customer merges record with who made them |
| POST | `/customer-merges/{id}/comments` | Adds a comment to one customer merges record for the support team |
| GET | `/customer-blocks` | Lists the customer blocks of the caller's stores, newest first, 50 per page |
| GET | `/customer-blocks/{id}` | Returns one customer blocks record with its history |
| POST | `/customer-blocks` | Creates a customer blocks record; the body is validated against the customer blocks schema |
| PATCH | `/customer-blocks/{id}` | Changes the fields of one customer blocks record that are still open |
| DELETE | `/customer-blocks/{id}` | Withdraws one customer blocks record; it stays readable for audit |
| GET | `/customer-blocks/{id}/history` | Lists the changes of one customer blocks record with who made them |
| POST | `/customer-blocks/{id}/comments` | Adds a comment to one customer blocks record for the support team |
| GET | `/customer-events` | Lists the customer events of the caller's stores, newest first, 50 per page |
| GET | `/customer-events/{id}` | Returns one customer events record with its history |
| POST | `/customer-events` | Creates a customer events record; the body is validated against the customer events schema |
| PATCH | `/customer-events/{id}` | Changes the fields of one customer events record that are still open |
| DELETE | `/customer-events/{id}` | Withdraws one customer events record; it stays readable for audit |
| GET | `/customer-events/{id}/history` | Lists the changes of one customer events record with who made them |
| POST | `/customer-events/{id}/comments` | Adds a comment to one customer events record for the support team |

## Reports

Read-only extracts for the business teams, refreshed every night.

| Method | Path | What it does |
| --- | --- | --- |
| GET | `/reports/stock-levels` | Stock level per store and item at the start of the day, as JSON |
| GET | `/reports/weekly-returns` | Returned orders of the past week with their reasons, as CSV |
| GET | `/reports/open-invoices` | Invoices not paid yet, grouped by customer tier, as JSON |
| GET | `/reports/voucher-usage` | Vouchers redeemed per promotion and store, as JSON |
| GET | `/reports/tax-summary` | Tax collected per tax code and month, as XLSX |
| GET | `/reports/late-payers` | Customers with an invoice over 30 days late, as JSON |
| GET | `/reports/daily-sales` | Sales per store and day, exported as CSV and kept for 90 days |
| GET | `/reports/channel-mix` | Share of orders per sales channel and week, as JSON |
