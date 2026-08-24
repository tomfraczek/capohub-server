import { GlobalRole } from '../auth/permissions/global-role.enum';
import { AvatarType } from './enums/avatar-type.enum';
import { SongCapabilitiesDto } from './dto/song-capabilities.dto';
import { User } from './entities/user.entity';
import { toUserResponseDto } from './user.mapper';
import { PublicUrlBuilder } from '../storage/image-url.util';

function buildUrlBuilder(): PublicUrlBuilder {
  return { buildPublicUrl: (key) => `https://cdn.example.com/${key}` };
}

const NO_SONG_CAPABILITIES: SongCapabilitiesDto = {
  canCreate: false,
  canApproveContent: false,
  canHideContent: false,
  canDeleteAnyDraft: false,
};

function buildUser(overrides: Partial<User> = {}): User {
  const user = new User();
  user.id = 'user-uuid-1';
  user.clerkUserId = 'user_clerk_1';
  user.email = 'dev@example.com';
  user.displayName = 'Ada Lovelace';
  user.avatarType = AvatarType.CLERK;
  user.avatarUrl = 'https://img.clerk.com/ada.png';
  user.presetAvatarId = null;
  user.theme = 'dark';
  user.notificationsEnabled = false;
  user.globalRole = GlobalRole.EDITOR;
  user.isActive = true;
  user.publicCode = 'ABCD-1234';
  user.lastLoginAt = new Date('2026-07-10T10:00:00.000Z');
  user.createdAt = new Date('2026-01-01T00:00:00.000Z');
  user.updatedAt = new Date('2026-02-01T00:00:00.000Z');
  return Object.assign(user, overrides);
}

describe('toUserResponseDto', () => {
  it('maps the exposed fields', () => {
    const user = buildUser();

    expect(
      toUserResponseDto(user, NO_SONG_CAPABILITIES, buildUrlBuilder()),
    ).toEqual({
      id: 'user-uuid-1',
      email: 'dev@example.com',
      displayName: 'Ada Lovelace',
      avatarType: AvatarType.CLERK,
      avatarUrl: 'https://img.clerk.com/ada.png',
      presetAvatarId: null,
      theme: 'dark',
      notificationsEnabled: false,
      globalRole: GlobalRole.EDITOR,
      songCapabilities: NO_SONG_CAPABILITIES,
      publicCode: 'ABCD-1234',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-02-01T00:00:00.000Z',
    });
  });

  it('passes the given songCapabilities through unchanged', () => {
    const user = buildUser();
    const capabilities: SongCapabilitiesDto = {
      canCreate: true,
      canApproveContent: true,
      canHideContent: true,
      canDeleteAnyDraft: true,
    };

    expect(
      toUserResponseDto(user, capabilities, buildUrlBuilder()).songCapabilities,
    ).toEqual(capabilities);
  });

  it('serializes dates as ISO 8601 strings', () => {
    const user = buildUser();
    const dto = toUserResponseDto(
      user,
      NO_SONG_CAPABILITIES,
      buildUrlBuilder(),
    );

    expect(dto.createdAt).toBe(user.createdAt.toISOString());
    expect(dto.updatedAt).toBe(user.updatedAt.toISOString());
  });

  it('passes through null for avatarUrl', () => {
    const user = buildUser({ avatarUrl: null });

    expect(
      toUserResponseDto(user, NO_SONG_CAPABILITIES, buildUrlBuilder()),
    ).toMatchObject({
      avatarUrl: null,
    });
  });

  it('maps a PRESET avatar (presetAvatarId set, avatarUrl null)', () => {
    const user = buildUser({
      avatarType: AvatarType.PRESET,
      presetAvatarId: 'berimbau-01',
      avatarUrl: null,
    });

    expect(
      toUserResponseDto(user, NO_SONG_CAPABILITIES, buildUrlBuilder()),
    ).toMatchObject({
      avatarType: AvatarType.PRESET,
      presetAvatarId: 'berimbau-01',
      avatarUrl: null,
    });
  });

  it('prefers the R2 public URL derived from avatarImageKey over the legacy avatarUrl for an UPLOAD avatar', () => {
    const user = buildUser({
      avatarType: AvatarType.UPLOAD,
      avatarUrl: null,
      avatarImageKey: 'users/user-uuid-1/profile/uuid.webp',
      presetAvatarId: null,
    });

    const dto = toUserResponseDto(
      user,
      NO_SONG_CAPABILITIES,
      buildUrlBuilder(),
    );

    expect(dto.avatarUrl).toBe(
      'https://cdn.example.com/users/user-uuid-1/profile/uuid.webp',
    );
  });

  it('never includes clerkUserId, isActive, or lastLoginAt', () => {
    const user = buildUser();
    const dto = toUserResponseDto(
      user,
      NO_SONG_CAPABILITIES,
      buildUrlBuilder(),
    );

    expect(dto).not.toHaveProperty('clerkUserId');
    expect(dto).not.toHaveProperty('isActive');
    expect(dto).not.toHaveProperty('lastLoginAt');
  });

  it('never includes firstName or lastName', () => {
    const user = buildUser();
    const dto = toUserResponseDto(
      user,
      NO_SONG_CAPABILITIES,
      buildUrlBuilder(),
    );

    expect(dto).not.toHaveProperty('firstName');
    expect(dto).not.toHaveProperty('lastName');
  });
});
