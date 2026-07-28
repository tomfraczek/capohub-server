import { GlobalRole } from '../auth/permissions/global-role.enum';
import { AvatarType } from './enums/avatar-type.enum';
import { User } from './entities/user.entity';
import { toUserResponseDto } from './user.mapper';

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

    expect(toUserResponseDto(user)).toEqual({
      id: 'user-uuid-1',
      email: 'dev@example.com',
      displayName: 'Ada Lovelace',
      avatarType: AvatarType.CLERK,
      avatarUrl: 'https://img.clerk.com/ada.png',
      presetAvatarId: null,
      theme: 'dark',
      notificationsEnabled: false,
      globalRole: GlobalRole.EDITOR,
      publicCode: 'ABCD-1234',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-02-01T00:00:00.000Z',
    });
  });

  it('serializes dates as ISO 8601 strings', () => {
    const user = buildUser();
    const dto = toUserResponseDto(user);

    expect(dto.createdAt).toBe(user.createdAt.toISOString());
    expect(dto.updatedAt).toBe(user.updatedAt.toISOString());
  });

  it('passes through null for avatarUrl', () => {
    const user = buildUser({ avatarUrl: null });

    expect(toUserResponseDto(user)).toMatchObject({ avatarUrl: null });
  });

  it('maps a PRESET avatar (presetAvatarId set, avatarUrl null)', () => {
    const user = buildUser({
      avatarType: AvatarType.PRESET,
      presetAvatarId: 'berimbau-01',
      avatarUrl: null,
    });

    expect(toUserResponseDto(user)).toMatchObject({
      avatarType: AvatarType.PRESET,
      presetAvatarId: 'berimbau-01',
      avatarUrl: null,
    });
  });

  it('never includes clerkUserId, isActive, or lastLoginAt', () => {
    const user = buildUser();
    const dto = toUserResponseDto(user);

    expect(dto).not.toHaveProperty('clerkUserId');
    expect(dto).not.toHaveProperty('isActive');
    expect(dto).not.toHaveProperty('lastLoginAt');
  });

  it('never includes firstName or lastName', () => {
    const user = buildUser();
    const dto = toUserResponseDto(user);

    expect(dto).not.toHaveProperty('firstName');
    expect(dto).not.toHaveProperty('lastName');
  });
});
