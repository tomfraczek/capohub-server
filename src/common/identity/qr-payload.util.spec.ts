import { EventType } from '../../events/enums/event-type.enum';
import {
  buildEventQrPayload,
  buildUserQrPayload,
  parseQrPayload,
} from './qr-payload.util';

const CONFIGURED_WEB_BASE_URL = 'https://capohub.pl';

describe('buildUserQrPayload / buildEventQrPayload', () => {
  it('builds a public https:// link once a web base URL is configured', () => {
    expect(buildUserQrPayload('042981', CONFIGURED_WEB_BASE_URL)).toBe(
      'https://capohub.pl/u/042981',
    );
  });

  it('preserves leading zeros, including 000000', () => {
    expect(buildUserQrPayload('000000', CONFIGURED_WEB_BASE_URL)).toBe(
      'https://capohub.pl/u/000000',
    );
    expect(buildUserQrPayload('000001', CONFIGURED_WEB_BASE_URL)).toBe(
      'https://capohub.pl/u/000001',
    );
  });

  // No public users yet (see the task history) - there is no fallback
  // format, no temporary/placeholder QR. `null` is the one honest signal
  // that nothing was ever generated.
  it('returns null - never a capohub:// fallback or any other placeholder - when no public web domain is configured', () => {
    expect(buildUserQrPayload('042981', undefined)).toBeNull();
  });

  it('builds the short versioned Event payload using the fixed discriminator map', () => {
    expect(buildEventQrPayload(EventType.FESTIVAL, '123456')).toBe(
      'capohub:v1:f:123456',
    );
    expect(buildEventQrPayload(EventType.WORKSHOP, '123456')).toBe(
      'capohub:v1:w:123456',
    );
    expect(buildEventQrPayload(EventType.OPEN_RODA, '123456')).toBe(
      'capohub:v1:r:123456',
    );
    expect(buildEventQrPayload(EventType.OTHER, '123456')).toBe(
      'capohub:v1:e:123456',
    );
  });
});

describe('parseQrPayload', () => {
  it('parses a User https:// link matching the configured host', () => {
    expect(
      parseQrPayload('https://capohub.pl/u/042981', CONFIGURED_WEB_BASE_URL),
    ).toEqual({
      entityType: 'USER',
      numericCode: '042981',
    });
  });

  it('parses a User link with leading zeros, including 000000', () => {
    expect(
      parseQrPayload('https://capohub.pl/u/000000', CONFIGURED_WEB_BASE_URL),
    ).toEqual({
      entityType: 'USER',
      numericCode: '000000',
    });
  });

  // hostFrom() compares via `new URL(...).host`, which is inherently
  // insensitive to a trailing slash (a slash affects `.pathname`, never
  // `.host`) - this holds regardless of env.schema.ts's own trailing-slash
  // stripping, as a second, independent layer of robustness at the actual
  // comparison site.
  it('matches the host the same way whether or not allowedWebBaseUrl itself has a trailing slash', () => {
    expect(
      parseQrPayload('https://capohub.pl/u/042981', 'https://capohub.pl/'),
    ).toEqual({ entityType: 'USER', numericCode: '042981' });
    expect(
      parseQrPayload('https://capohub.pl/u/042981', 'https://capohub.pl'),
    ).toEqual({ entityType: 'USER', numericCode: '042981' });
  });

  it('rejects a User link whose host does not match the configured PUBLIC_WEB_BASE_URL', () => {
    expect(
      parseQrPayload('https://evil.example/u/042981', CONFIGURED_WEB_BASE_URL),
    ).toBeNull();
    expect(
      parseQrPayload(
        'https://staging.capohub.pl/u/042981',
        CONFIGURED_WEB_BASE_URL,
      ),
    ).toBeNull();
  });

  // No "correct" host exists to compare against - a User https link can
  // never be recognized at all until a real domain is configured.
  it('never recognizes a User https link when allowedWebBaseUrl is undefined', () => {
    expect(parseQrPayload('https://capohub.pl/u/042981')).toBeNull();
    expect(parseQrPayload('https://capohub.pl/u/042981', undefined)).toBeNull();
  });

  it('rejects a malformed User link numericCode without throwing', () => {
    expect(
      parseQrPayload('https://capohub.pl/u/12345', CONFIGURED_WEB_BASE_URL),
    ).toBeNull();
    expect(
      parseQrPayload('https://capohub.pl/u/1234567', CONFIGURED_WEB_BASE_URL),
    ).toBeNull();
    expect(
      parseQrPayload('https://capohub.pl/u/12a456', CONFIGURED_WEB_BASE_URL),
    ).toBeNull();
    expect(
      parseQrPayload('https://capohub.pl/u/', CONFIGURED_WEB_BASE_URL),
    ).toBeNull();
  });

  it('rejects a https link with a different path or a non-https scheme', () => {
    expect(
      parseQrPayload('https://capohub.pl/e/042981', CONFIGURED_WEB_BASE_URL),
    ).toBeNull();
    expect(
      parseQrPayload(
        'https://capohub.pl/users/042981',
        CONFIGURED_WEB_BASE_URL,
      ),
    ).toBeNull();
    expect(
      parseQrPayload('http://capohub.pl/u/042981', CONFIGURED_WEB_BASE_URL),
    ).toBeNull();
  });

  // The app has no public users yet - these are no longer "legacy, still
  // accepted" shapes, they are plain unrecognized garbage now, same as any
  // other malformed string.
  it.each(['capohub:v1:u:042981', 'capohub://u/042981'])(
    'no longer recognizes the removed legacy User QR shape %p',
    (removed) => {
      expect(parseQrPayload(removed, CONFIGURED_WEB_BASE_URL)).toBeNull();
      expect(parseQrPayload(removed)).toBeNull();
    },
  );

  it.each([
    ['f', EventType.FESTIVAL],
    ['w', EventType.WORKSHOP],
    ['r', EventType.OPEN_RODA],
    ['e', EventType.OTHER],
  ])(
    'parses a valid Event payload for discriminator %s -> %s, independent of the configured web domain',
    (discriminator, eventType) => {
      expect(parseQrPayload(`capohub:v1:${discriminator}:123456`)).toEqual({
        entityType: 'EVENT',
        eventType,
        numericCode: '123456',
      });
      expect(
        parseQrPayload(
          `capohub:v1:${discriminator}:123456`,
          CONFIGURED_WEB_BASE_URL,
        ),
      ).toEqual({
        entityType: 'EVENT',
        eventType,
        numericCode: '123456',
      });
    },
  );

  it('rejects an unknown version', () => {
    expect(parseQrPayload('capohub:v2:u:042981')).toBeNull();
    expect(parseQrPayload('capohub:v0:u:042981')).toBeNull();
  });

  it('rejects an unknown discriminator', () => {
    expect(parseQrPayload('capohub:v1:t:042981')).toBeNull();
    expect(parseQrPayload('capohub:v1:g:042981')).toBeNull();
    expect(parseQrPayload('capohub:v1:x:042981')).toBeNull();
  });

  it('rejects the pre-v1 long-form discriminator ("event:FESTIVAL") - only one wire format is live', () => {
    expect(parseQrPayload('capohub:v1:event:FESTIVAL:123456')).toBeNull();
    expect(parseQrPayload('capohub:v1:event:WORKSHOP:123456')).toBeNull();
    expect(parseQrPayload('capohub:v1:event:OPEN_RODA:123456')).toBeNull();
    expect(parseQrPayload('capohub:v1:event:OTHER:123456')).toBeNull();
    expect(parseQrPayload('capohub:v1:user:042981')).toBeNull();
  });

  it('rejects a malformed Event numericCode without throwing', () => {
    expect(parseQrPayload('capohub:v1:f:abcdef')).toBeNull();
    expect(parseQrPayload('capohub:v1:f:12345')).toBeNull();
    expect(parseQrPayload('capohub:v1:f:1234567')).toBeNull();
  });

  it('rejects extra or missing segments', () => {
    expect(parseQrPayload('capohub:v1:f:042981:extra')).toBeNull();
    expect(parseQrPayload('capohub:v1:f')).toBeNull();
    expect(parseQrPayload('capohub:v1')).toBeNull();
    expect(parseQrPayload('capohub')).toBeNull();
  });

  it('rejects legacy/fake prefixes and arbitrary garbage without throwing', () => {
    expect(parseQrPayload('')).toBeNull();
    expect(parseQrPayload('not-a-payload')).toBeNull();
    expect(parseQrPayload('U123-456')).toBeNull();
    expect(parseQrPayload('F123-456')).toBeNull();
    expect(parseQrPayload('capohub:f:042981')).toBeNull();
    expect(parseQrPayload('otherapp:v1:f:042981')).toBeNull();
    expect(() => parseQrPayload(' garbage')).not.toThrow();
  });

  it('never returns a shape carrying a UUID/email/name field', () => {
    const parsed = parseQrPayload(
      'https://capohub.pl/u/042981',
      CONFIGURED_WEB_BASE_URL,
    );
    expect(parsed).not.toHaveProperty('userId');
    expect(parsed).not.toHaveProperty('email');
    expect(parsed).not.toHaveProperty('displayName');
  });
});
