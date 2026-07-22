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

## Multi-value filters

A filter that accepts several ids (e.g. `tagIds` on `GET /songs`) is passed
as one comma-separated query param, not repeated params:

```
?tagIds=uuid1,uuid2
```

Unless an endpoint says otherwise, this semantics is **AND**: a matching
record must satisfy every value in the list (e.g. `GET /songs?tagIds=a,b`
returns only songs tagged with both `a` and `b`, not either).

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

## Dashboard section shape

Endpoints that aggregate several bounded sub-lists for a single dashboard
view (e.g. `GET /community/home`) do not use the page/limit list response
shape above for each section - there is no page to navigate to, only a
capped preview with a link to the full, dedicated screen. Each section
instead uses:

```json
{
  "items": [],
  "total": 0,
  "hasMore": false
}
```

`total` and `hasMore` always describe the full matching set, not just
`items`, so summary counters built from `total` stay consistent with what
the section actually reports.

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
