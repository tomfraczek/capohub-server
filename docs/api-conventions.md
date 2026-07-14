# API Conventions

Established conventions for the Capoeira Hub API. Keep this short and
practical — update it only when a new convention is actually adopted.

## Endpoints

All routes are served under a versioned prefix:

```
/api/v1
```

## Identifiers

Entity IDs are UUIDs, represented as strings.

## Dates

Dates in API responses are returned as ISO 8601 strings in UTC
(e.g. `2026-07-10T10:00:00.000Z`).

## Pagination

Offset/page-based pagination via query params:

```
?page=1&limit=20
```

- `page`: integer, minimum 1, default 1.
- `limit`: integer, minimum 1, maximum 100, default 20.

See `src/common/pagination/`.

## Sorting

```
?sort=field
?sort=-field
```

A bare field name sorts ascending; a `-` prefix sorts descending. Each
endpoint defines its own allowlist of sortable fields.

See `src/common/sorting/`.

## List response shape

```json
{
  "data": [],
  "meta": {
    "page": 1,
    "limit": 20,
    "totalItems": 0,
    "totalPages": 0,
    "hasNextPage": false,
    "hasPreviousPage": false
  }
}
```

## Errors

```json
{
  "statusCode": 400,
  "code": "VALIDATION_ERROR",
  "message": "Validation failed",
  "errors": [],
  "path": "/api/v1/example",
  "timestamp": "2026-07-10T10:00:00.000Z"
}
```

See `src/common/filters/http-exception.filter.ts` and
`src/common/pipes/zod-validation.pipe.ts`.
