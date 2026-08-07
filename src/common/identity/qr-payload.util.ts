import { EventType } from '../../events/enums/event-type.enum';
import { NUMERIC_CODE_PATTERN } from '../utils/numeric-code';

// Stable, versioned, text-only QR identity payload for User and Event (see
// the module spec §7). numericCode and QR are not two different
// identifiers - QR is only ever an encoding of the same numericCode
// already stored on the entity (see user.entity.ts / event.entity.ts).
// This payload deliberately carries nothing but a version marker, a
// single-letter discriminator, and (for Event) the numericCode's own
// (type, numericCode) pair - never a UUID, clerkUserId, email, name, or
// anything auth-related. Scanning this string identifies a resource; it
// never grants any capability and never performs a mutation on its own
// (see the module spec's own "not a secret, not a token" framing).
//
// Format: capohub:v1:<discriminator>:<6 digits>
//   u -> User
//   f -> Event FESTIVAL
//   w -> Event WORKSHOP
//   r -> Event OPEN_RODA
//   e -> Event OTHER
//
// The discriminator is a fixed, explicit protocol constant - never derived
// from EventType's own spelling (e.g. its first letter), so renaming an
// EventType enum member can never silently change the QR wire format.
const PAYLOAD_PREFIX = 'capohub';
const PAYLOAD_VERSION = 'v1';
const USER_DISCRIMINATOR = 'u';

const EVENT_TYPE_QR_DISCRIMINATORS: Readonly<Record<EventType, string>> = {
  [EventType.FESTIVAL]: 'f',
  [EventType.WORKSHOP]: 'w',
  [EventType.OPEN_RODA]: 'r',
  [EventType.OTHER]: 'e',
};

const EVENT_TYPE_BY_QR_DISCRIMINATOR: ReadonlyMap<string, EventType> = new Map(
  Object.entries(EVENT_TYPE_QR_DISCRIMINATORS).map(([type, discriminator]) => [
    discriminator,
    type as EventType,
  ]),
);

export type ParsedQrPayload =
  | { entityType: 'USER'; numericCode: string }
  | { entityType: 'EVENT'; eventType: EventType; numericCode: string };

export function buildUserQrPayload(numericCode: string): string {
  return `${PAYLOAD_PREFIX}:${PAYLOAD_VERSION}:${USER_DISCRIMINATOR}:${numericCode}`;
}

export function buildEventQrPayload(
  eventType: EventType,
  numericCode: string,
): string {
  return `${PAYLOAD_PREFIX}:${PAYLOAD_VERSION}:${EVENT_TYPE_QR_DISCRIMINATORS[eventType]}:${numericCode}`;
}

/**
 * Parses a raw QR payload string, rejecting anything that isn't exactly
 * `capohub:v1:<discriminator>:<6 digits>` with a known discriminator:
 * unknown version, unknown discriminator, wrong segment count, or a
 * numericCode that isn't exactly 6 digits all return `null` rather than
 * throwing - a malformed scan is an ordinary, expected input here, never a
 * 500 (see the module spec §17). The pre-v1 long-form event discriminator
 * (`event:FESTIVAL`) is deliberately not accepted - the frontend never
 * shipped it, so there is exactly one live wire format, not two. Never
 * accepts the frontend's display format ("U123-456") either - that is a
 * presentation concern, not this payload's contract (see the lookup DTOs'
 * own normalizeNumericCodeInput for the display-format case).
 */
export function parseQrPayload(raw: string): ParsedQrPayload | null {
  const parts = raw.split(':');
  if (
    parts.length !== 4 ||
    parts[0] !== PAYLOAD_PREFIX ||
    parts[1] !== PAYLOAD_VERSION
  ) {
    return null;
  }

  const [, , discriminator, numericCode] = parts;
  if (!NUMERIC_CODE_PATTERN.test(numericCode)) {
    return null;
  }

  if (discriminator === USER_DISCRIMINATOR) {
    return { entityType: 'USER', numericCode };
  }

  const eventType = EVENT_TYPE_BY_QR_DISCRIMINATOR.get(discriminator);
  if (eventType) {
    return { entityType: 'EVENT', eventType, numericCode };
  }

  return null;
}
