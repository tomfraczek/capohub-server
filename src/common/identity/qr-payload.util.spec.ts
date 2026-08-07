import { EventType } from '../../events/enums/event-type.enum';
import {
  buildEventQrPayload,
  buildUserQrPayload,
  parseQrPayload,
} from './qr-payload.util';

describe('buildUserQrPayload / buildEventQrPayload', () => {
  it('builds the short versioned User payload', () => {
    expect(buildUserQrPayload('042981')).toBe('capohub:v1:u:042981');
  });

  it('preserves leading zeros, including 000000', () => {
    expect(buildUserQrPayload('000000')).toBe('capohub:v1:u:000000');
    expect(buildUserQrPayload('000001')).toBe('capohub:v1:u:000001');
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
  it('parses a valid User payload (u)', () => {
    expect(parseQrPayload('capohub:v1:u:042981')).toEqual({
      entityType: 'USER',
      numericCode: '042981',
    });
  });

  it('parses a User payload with leading zeros, including 000000', () => {
    expect(parseQrPayload('capohub:v1:u:000000')).toEqual({
      entityType: 'USER',
      numericCode: '000000',
    });
  });

  it.each([
    ['f', EventType.FESTIVAL],
    ['w', EventType.WORKSHOP],
    ['r', EventType.OPEN_RODA],
    ['e', EventType.OTHER],
  ])(
    'parses a valid Event payload for discriminator %s -> %s',
    (discriminator, eventType) => {
      expect(parseQrPayload(`capohub:v1:${discriminator}:123456`)).toEqual({
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

  it('rejects a malformed numericCode without throwing', () => {
    expect(parseQrPayload('capohub:v1:u:12345')).toBeNull();
    expect(parseQrPayload('capohub:v1:u:1234567')).toBeNull();
    expect(parseQrPayload('capohub:v1:u:12a456')).toBeNull();
    expect(parseQrPayload('capohub:v1:f:abcdef')).toBeNull();
  });

  it('rejects extra or missing segments', () => {
    expect(parseQrPayload('capohub:v1:u:042981:extra')).toBeNull();
    expect(parseQrPayload('capohub:v1:u')).toBeNull();
    expect(parseQrPayload('capohub:v1')).toBeNull();
    expect(parseQrPayload('capohub')).toBeNull();
  });

  it('rejects legacy/fake prefixes and arbitrary garbage without throwing', () => {
    expect(parseQrPayload('')).toBeNull();
    expect(parseQrPayload('not-a-payload')).toBeNull();
    expect(parseQrPayload('U123-456')).toBeNull();
    expect(parseQrPayload('F123-456')).toBeNull();
    expect(parseQrPayload('capohub:u:042981')).toBeNull();
    expect(parseQrPayload('otherapp:v1:u:042981')).toBeNull();
    expect(() => parseQrPayload(' garbage')).not.toThrow();
  });

  it('never returns a shape carrying a UUID/email/name field', () => {
    const parsed = parseQrPayload('capohub:v1:u:042981');
    expect(parsed).not.toHaveProperty('userId');
    expect(parsed).not.toHaveProperty('email');
    expect(parsed).not.toHaveProperty('displayName');
  });
});
