import { EventType } from '../../events/enums/event-type.enum';
import { NUMERIC_CODE_PATTERN } from '../utils/numeric-code';

// Stable, text-only QR identity payload for User and Event. numericCode
// and QR are not two different identifiers - QR is only ever an encoding
// of the same numericCode already stored on the entity (see
// user.entity.ts / event.entity.ts). This payload deliberately carries
// nothing but a version marker/scheme, a single-letter discriminator, and
// (for Event) the numericCode's own (type, numericCode) pair - never a
// UUID, clerkUserId, email, name, or anything auth-related. Scanning this
// string identifies a resource; it never grants any capability and never
// performs a mutation on its own (see the module spec's own "not a
// secret, not a token" framing).
//
// User's QR is a real, public HTTPS link - `<PUBLIC_WEB_BASE_URL>/u/
// <numericCode>` (Android App Links - see app.config.ts's conditional
// intentFilters) - and *only* that: there is no fallback custom-scheme or
// legacy versioned form. The app has no public users yet, so there is
// nothing to stay backward-compatible with (see the task history) - a
// `capohub://u/...` or `capohub:v1:u:...` payload is no longer
// recognized as a User identity anywhere, including check-in (Event/
// Training) - see UserCheckInIdentityService. When PUBLIC_WEB_BASE_URL
// isn't configured, `buildUserQrPayload` returns `null` (never a
// fabricated/placeholder domain, never a temporary fallback format) and
// `parseQrPayload` can never recognize *any* User https link (there is no
// "correct" host to compare against). The host a scanned link is checked
// against is always the currently-configured PUBLIC_WEB_BASE_URL - never
// hardcoded, never accepted from an arbitrary domain.
//
// Event still uses the older opaque `capohub:v1:<f|w|r|e>:<6 digits>`
// form, entirely unrelated to and untouched by any of the above - this
// module owns both, but they are two independent identity spaces that
// happen to share this one file.
//
// Format:
//   User:  <PUBLIC_WEB_BASE_URL>/u/<6 digits>   (only shape; null when unconfigured)
//   Event: capohub:v1:<f|w|r|e>:<6 digits>
//     f -> FESTIVAL, w -> WORKSHOP, r -> OPEN_RODA, e -> OTHER
//
// The discriminator is a fixed, explicit protocol constant - never derived
// from EventType's own spelling (e.g. its first letter), so renaming an
// EventType enum member can never silently change the QR wire format.
const PAYLOAD_PREFIX = 'capohub';
const PAYLOAD_VERSION = 'v1';
const USER_PATH_SEGMENT = 'u';
// Captures (host, numericCode) - the host is compared against the caller's
// allowed host (derived from PUBLIC_WEB_BASE_URL) by the caller, never
// hardcoded here.
const USER_HTTPS_LINK_PATTERN = /^https:\/\/([^/]+)\/u\/([0-9]{6})$/;

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

// Never throws on a malformed URL - a misconfigured env value must fail
// closed (no host ever matches) rather than crash the request. This is
// the actual host-comparison site for the cross-repo PUBLIC_WEB_BASE_URL /
// EXPO_PUBLIC_WEB_BASE_URL invariant (see env.schema.ts's own comment) -
// `.host` is inherently insensitive to a trailing slash on `url` (a
// trailing slash affects `.pathname`, never `.host`), independent of
// env.schema.ts's own trailing-slash stripping.
function hostFrom(url: string): string | undefined {
  try {
    return new URL(url).host;
  } catch {
    return undefined;
  }
}

// `webBaseUrl` is AppConfigService.publicWebBaseUrl (already trimmed of
// any trailing slash - see env.schema.ts), undefined until a real public
// domain is configured. Returns `null` in that case - never a fabricated
// placeholder domain, never a fallback deep link/legacy format. The
// frontend ("Mój kod") must render a "not configured" state, not attempt
// to display a broken/absent QR as if it were valid - see
// get-resolve-identity-error-message.ts's sibling on the frontend for the
// user-facing copy.
export function buildUserQrPayload(
  numericCode: string,
  webBaseUrl: string | undefined,
): string | null {
  if (!webBaseUrl) {
    return null;
  }
  return `${webBaseUrl}/${USER_PATH_SEGMENT}/${numericCode}`;
}

export function buildEventQrPayload(
  eventType: EventType,
  numericCode: string,
): string {
  return `${PAYLOAD_PREFIX}:${PAYLOAD_VERSION}:${EVENT_TYPE_QR_DISCRIMINATORS[eventType]}:${numericCode}`;
}

/**
 * Parses a raw QR payload string. A User identity is recognized *only* as
 * `https://<allowedWebBaseUrl's host>/u/<6 digits>` - `allowedWebBaseUrl`
 * is always the caller's current AppConfigService.publicWebBaseUrl, never
 * hardcoded and never optional-but-guessed; when it's undefined (no public
 * domain configured), no https input can ever be recognized as a User -
 * there is no "correct" host to compare against, so every such input
 * falls through to `null`. A different host than the configured one is
 * rejected the same way, even if it's shaped exactly like a User link -
 * this is a plain identity, not a wildcard "any /u/ path". Event's shape
 * (`capohub:v1:<discriminator>:<6 digits>`) is independent and always
 * parsed regardless of `allowedWebBaseUrl`. Unknown discriminator, wrong
 * segment count, or a numericCode that isn't exactly 6 digits all return
 * `null` rather than throwing - a malformed scan is an ordinary, expected
 * input here, never a 500. Never accepts the frontend's display format
 * ("U123-456") either - that is a presentation concern, not this
 * payload's contract (see the lookup DTOs' own normalizeNumericCodeInput
 * for the display-format case).
 */
export function parseQrPayload(
  raw: string,
  allowedWebBaseUrl?: string,
): ParsedQrPayload | null {
  const allowedHost = allowedWebBaseUrl
    ? hostFrom(allowedWebBaseUrl)
    : undefined;
  if (allowedHost) {
    const httpsMatch = USER_HTTPS_LINK_PATTERN.exec(raw);
    if (httpsMatch && httpsMatch[1] === allowedHost) {
      return { entityType: 'USER', numericCode: httpsMatch[2] };
    }
  }

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

  const eventType = EVENT_TYPE_BY_QR_DISCRIMINATOR.get(discriminator);
  if (eventType) {
    return { entityType: 'EVENT', eventType, numericCode };
  }

  return null;
}
