# Blueprint

The shape of the new platform: small services that own their data and talk through events.

## Communication

Services publish an event for every change of state and read other services' data only through their queries. A synchronous call is allowed for a query, never for a change.

## Data

Each service owns one database schema; no service reads another service's tables.
