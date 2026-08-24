import { AppConfigService } from '../config/app.config';
import { assertR2Configured } from './r2-client.provider';

function buildAppConfig(
  overrides: Partial<AppConfigService> = {},
): AppConfigService {
  return {
    r2Endpoint: 'https://accountid.r2.cloudflarestorage.com',
    r2AccessKeyId: 'access-key',
    r2SecretAccessKey: 'secret-key',
    r2Bucket: 'capohub',
    r2PublicUrl: 'https://pub-abc123.r2.dev',
    ...overrides,
  } as unknown as AppConfigService;
}

describe('assertR2Configured', () => {
  it('does not throw when every R2_* value is present', () => {
    expect(() => assertR2Configured(buildAppConfig())).not.toThrow();
  });

  it.each([
    ['r2Endpoint', 'R2_ENDPOINT'],
    ['r2AccessKeyId', 'R2_ACCESS_KEY_ID'],
    ['r2SecretAccessKey', 'R2_SECRET_ACCESS_KEY'],
    ['r2Bucket', 'R2_BUCKET'],
    ['r2PublicUrl', 'R2_PUBLIC_URL'],
  ])(
    'throws a readable error naming %s when only %s is missing',
    (field, envName) => {
      const config = buildAppConfig({ [field]: '' });

      expect(() => assertR2Configured(config)).toThrow(
        new RegExp(`R2 storage is not configured.*${envName}`),
      );
    },
  );

  it('names every missing variable at once, not just the first', () => {
    const config = buildAppConfig({ r2Endpoint: '', r2Bucket: '' });

    expect(() => assertR2Configured(config)).toThrow(
      /R2_ENDPOINT.*R2_BUCKET|R2_BUCKET.*R2_ENDPOINT/,
    );
  });
});
