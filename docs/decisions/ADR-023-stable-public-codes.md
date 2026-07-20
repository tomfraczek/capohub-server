# ADR-023: Stable Public Codes

## Status

Accepted

## Context

Internal identifiers ([ADR-022](ADR-022-immutable-identifiers.md)) are not
meant to be user-facing. Some values, however, need to be shown to and
shared by end users - in invitation links, QR codes, printed
certificates, and event registration - and those need their own stability
guarantee independent from internal storage concerns.

## Decision

Public Codes are stable business identifiers, distinct from internal
identifiers and independent from database identifiers. Public Codes may
appear in invitation links, QR codes, printed certificates, and event
registration, and should remain stable once issued.

## Consequences

A previously printed certificate or shared invitation link keeps working
even if internal storage identifiers or database structure change. See
[Invitations](../architecture/organization-domain.md#invitations) for
where Public Codes are used.
