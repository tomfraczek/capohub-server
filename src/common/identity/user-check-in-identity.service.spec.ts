import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { EntityManager } from '@mikro-orm/postgresql';
import { AppConfigService } from '../../config/app.config';
import { User } from '../../users/entities/user.entity';
import { UserCheckInIdentityService } from './user-check-in-identity.service';

const CONFIGURED_HOST_URL = 'https://capohub.test';

function buildUser(overrides: Partial<User> = {}): User {
  const user = new User();
  user.id = 'user-1';
  user.email = 'ada@example.com';
  user.displayName = 'Ada';
  user.numericCode = '042981';
  return Object.assign(user, overrides);
}

function buildMockEm(user: User | null): {
  em: EntityManager;
  findOne: jest.Mock;
} {
  const findOne = jest.fn().mockResolvedValue(user);
  return { em: { findOne } as unknown as EntityManager, findOne };
}

// A trivial, structural stand-in for AppConfigService - only
// publicWebBaseUrl is ever read by UserCheckInIdentityService.
function buildMockAppConfig(
  publicWebBaseUrl: string | undefined = CONFIGURED_HOST_URL,
): AppConfigService {
  return { publicWebBaseUrl } as unknown as AppConfigService;
}

describe('UserCheckInIdentityService', () => {
  it('resolves a raw 6-digit numeric code, method MANUAL', async () => {
    const user = buildUser();
    const { em, findOne } = buildMockEm(user);
    const service = new UserCheckInIdentityService(em, buildMockAppConfig());

    const resolved = await service.resolve('042981', em);

    expect(resolved.user).toBe(user);
    expect(resolved.method).toBe('MANUAL');
    expect(findOne).toHaveBeenCalledWith(User, { numericCode: '042981' });
  });

  it('resolves the dashed display form "042-981"', async () => {
    const user = buildUser();
    const { em } = buildMockEm(user);
    const service = new UserCheckInIdentityService(em, buildMockAppConfig());

    const resolved = await service.resolve('042-981', em);

    expect(resolved.user).toBe(user);
    expect(resolved.method).toBe('MANUAL');
  });

  it('resolves the human-display "U042-981" form (leading U stripped)', async () => {
    const user = buildUser();
    const { em, findOne } = buildMockEm(user);
    const service = new UserCheckInIdentityService(em, buildMockAppConfig());

    const resolved = await service.resolve('U042-981', em);

    expect(resolved.user).toBe(user);
    expect(findOne).toHaveBeenCalledWith(User, { numericCode: '042981' });
  });

  it('resolves a lowercase "u042981" form too', async () => {
    const user = buildUser();
    const { em } = buildMockEm(user);
    const service = new UserCheckInIdentityService(em, buildMockAppConfig());

    const resolved = await service.resolve('u042981', em);

    expect(resolved.user).toBe(user);
  });

  it('resolves a User QR payload (https://<configured host>/u/<code>), method QR', async () => {
    const user = buildUser();
    const { em, findOne } = buildMockEm(user);
    const service = new UserCheckInIdentityService(em, buildMockAppConfig());

    const resolved = await service.resolve(
      `${CONFIGURED_HOST_URL}/u/042981`,
      em,
    );

    expect(resolved.user).toBe(user);
    expect(resolved.method).toBe('QR');
    expect(findOne).toHaveBeenCalledWith(User, { numericCode: '042981' });
  });

  it('rejects a User QR from a different host than the configured PUBLIC_WEB_BASE_URL', async () => {
    const { em } = buildMockEm(null);
    const service = new UserCheckInIdentityService(em, buildMockAppConfig());

    await expect(
      service.resolve('https://evil.example/u/042981', em),
    ).rejects.toMatchObject({
      response: { code: 'INVALID_CHECK_IN_IDENTITY' },
    });
  });

  it('never resolves any User QR link when no public web domain is configured', async () => {
    const { em } = buildMockEm(null);
    const service = new UserCheckInIdentityService(
      em,
      buildMockAppConfig(undefined),
    );

    await expect(
      service.resolve(`${CONFIGURED_HOST_URL}/u/042981`, em),
    ).rejects.toMatchObject({
      response: { code: 'INVALID_CHECK_IN_IDENTITY' },
    });
  });

  // The app has no public users yet (see the task history) - these legacy
  // shapes are not "still accepted for compatibility", they are plain
  // malformed input now, exactly like any other garbage string.
  it.each(['capohub:v1:u:042981', 'capohub://u/042981'])(
    'no longer recognizes the removed legacy User QR shape %p',
    async (legacy) => {
      const { em } = buildMockEm(null);
      const service = new UserCheckInIdentityService(em, buildMockAppConfig());

      await expect(service.resolve(legacy, em)).rejects.toMatchObject({
        response: { code: 'INVALID_CHECK_IN_IDENTITY' },
      });
    },
  );

  it.each([
    'capohub:v1:f:042981',
    'capohub:v1:w:042981',
    'capohub:v1:r:042981',
    'capohub:v1:e:042981',
  ])(
    'rejects an Event QR payload %p with WRONG_IDENTITY_TYPE',
    async (eventQr) => {
      const { em } = buildMockEm(null);
      const service = new UserCheckInIdentityService(em, buildMockAppConfig());

      await expect(service.resolve(eventQr, em)).rejects.toMatchObject({
        response: { code: 'WRONG_IDENTITY_TYPE' },
      });
      await expect(service.resolve(eventQr, em)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    },
  );

  it.each(['', 'abc', '12345', '1234567', 'capohub:v2:u:042981'])(
    'rejects malformed identity %p with INVALID_CHECK_IN_IDENTITY (400, never 500)',
    async (malformed) => {
      const { em } = buildMockEm(null);
      const service = new UserCheckInIdentityService(em, buildMockAppConfig());

      await expect(service.resolve(malformed, em)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    },
  );

  it('throws USER_NOT_FOUND (404) when the code is well-formed but unassigned', async () => {
    const { em } = buildMockEm(null);
    const service = new UserCheckInIdentityService(em, buildMockAppConfig());

    await expect(service.resolve('000000', em)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
