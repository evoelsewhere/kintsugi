# Error handling

How a service reports, retries and logs its failures.

## Error responses

Every error response is a problem document with a stable `type` URI and a short title.

## Retries

A call to another service or to the payment gateway is retried at most 3 times, waiting 200 ms, then 400 ms, then 800 ms between attempts. A call that changes data is retried only when it carries an idempotency key.

## Logging failures

Failures are logged through the structured logging component, never printed.
