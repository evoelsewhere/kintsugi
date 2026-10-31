# Data migration

How the customer and order history moves from the mainframe files to the new databases.

## Order history

Orders of the last seven years are copied in monthly slices, oldest first.

## Export job

The export job reads the mainframe files overnight and writes them as CSV files to the landing zone, where the loaders pick them up in the morning.

Records are processed in batches. The batch size is set by the environment variable `EXPORT_BATCH_SIZE`, 5000 by default; a failed batch is retried on its own.

## Validation

Each slice is counted and summed on both sides before it is accepted.
