/**
 * Unit tests for GroupAudienceService - GET /groups/:id/followers: the
 * member/follower union and its flags, privacy-resolved names, sorting/
 * pagination, and the batched "effective rank" mirror of the public
 * profile.
 */

import type { EntityManager } from '@mikro-orm/postgresql';
import { CustomUserRank } from '../graduation/entities/custom-user-rank.entity';
import { FormalRankAssignment } from '../graduation/entities/formal-rank-assignment.entity';
import type { R2StorageService } from '../storage/r2-storage.service';
import { User } from '../users/entities/user.entity';
import { AvatarType } from '../users/enums/avatar-type.enum';
import { FormalGroupAffiliation } from './entities/formal-group-affiliation.entity';
import { GroupFollow } from './entities/group-follow.entity';
import { RoleAssignment } from './entities/role-assignment.entity';
import { GroupRole } from './enums/group-role.enum';
import { SectionMembership } from './entities/section-membership.entity';
import { GroupAudienceService } from './group-audience.service';

type Rows = Partial<Record<string, unknown[]>>;

function buildUser(overrides: Partial<User> & { id: string }): User {
  return {
    firstName: null,
    lastName: null,
    apelido: null,
    publicCode: `CODE-${overrides.id}`,
    showFormalGroup: false,
    showFormalRank: false,
    avatarType: AvatarType.CLERK,
    avatarUrl: null,
    avatarImageKey: null,
    presetAvatarId: null,
    ...overrides,
  } as unknown as User;
}

function segments(colorHex: string) {
  return { getItems: () => [{ position: 1, colorHex, proportion: 100 }] };
}

function buildService(rows: Rows) {
  const find = jest.fn((entity: { name: string }) =>
    Promise.resolve(rows[entity.name] ?? []),
  );
  const em = { find } as unknown as EntityManager;
  const r2 = {
    buildPublicUrl: jest.fn(() => 'https://cdn/avatar'),
  } as unknown as R2StorageService;
  return { service: new GroupAudienceService(em, r2), find };
}

describe('GroupAudienceService', () => {
  it('returns an empty page without loading users when nobody is tied to the Group', async () => {
    const { service, find } = buildService({});

    const result = await service.list('group-1', { limit: 20, offset: 0 });

    expect(result).toEqual({ items: [], total: 0 });
    expect(find).not.toHaveBeenCalledWith(User, expect.anything());
  });

  it('merges Section members and followers into one row per user with both flags', async () => {
    const { service } = buildService({
      [SectionMembership.name]: [
        { id: 'm1', user: { id: 'u1' }, section: { id: 's1', name: 'Kraków' } },
        { id: 'm2', user: { id: 'u2' }, section: { id: 's1', name: 'Kraków' } },
        {
          id: 'm3',
          user: { id: 'u2' },
          section: { id: 's2', name: 'Bochnia' },
        },
      ],
      [GroupFollow.name]: [{ user: { id: 'u2' } }, { user: { id: 'u3' } }],
      [User.name]: [
        buildUser({ id: 'u1', publicCode: 'A' }),
        buildUser({ id: 'u2', publicCode: 'B' }),
        buildUser({ id: 'u3', publicCode: 'C' }),
      ],
    });

    const result = await service.list('group-1', { limit: 20, offset: 0 });

    expect(result.total).toBe(3);
    expect(
      result.items.map((item) => [
        item.user.id,
        item.isMemberThroughSection,
        item.isFollowing,
      ]),
    ).toEqual([
      ['u1', true, false],
      ['u2', true, true],
      ['u3', false, true],
    ]);
    // Sorted by Section name, so the app can list them predictably.
    expect(result.items[1].memberships).toEqual([
      { membershipId: 'm3', sectionId: 's2', sectionName: 'Bochnia' },
      { membershipId: 'm2', sectionId: 's1', sectionName: 'Kraków' },
    ]);
    expect(result.items[2].memberships).toEqual([]);
  });

  it('flags the Group OWNER with isOwner, alongside their Section memberships', async () => {
    const { service, find } = buildService({
      [SectionMembership.name]: [
        { id: 'm1', user: { id: 'u1' }, section: { id: 's1', name: 'Kraków' } },
        { id: 'm2', user: { id: 'u2' }, section: { id: 's1', name: 'Kraków' } },
      ],
      [RoleAssignment.name]: [{ user: { id: 'u1' } }],
      [User.name]: [
        buildUser({ id: 'u1', publicCode: 'A' }),
        buildUser({ id: 'u2', publicCode: 'B' }),
      ],
    });

    const result = await service.list('group-1', { limit: 20, offset: 0 });

    expect(find).toHaveBeenCalledWith(
      RoleAssignment,
      { group: 'group-1', role: GroupRole.OWNER, revokedAt: null },
      expect.anything(),
    );
    expect(
      result.items.map((item) => [
        item.user.id,
        item.isOwner,
        item.isMemberThroughSection,
      ]),
    ).toEqual([
      ['u1', true, true],
      ['u2', false, true],
    ]);
  });

  it('always returns the real name and apelido - never the code in place of an existing name', async () => {
    const { service } = buildService({
      [GroupFollow.name]: [{ user: { id: 'u1' } }, { user: { id: 'u2' } }],
      [User.name]: [
        buildUser({
          id: 'u1',
          firstName: 'Krzysztof',
          lastName: 'Kowalski',
          apelido: 'Gato',
          publicCode: '2H7V-8AWZ',
        }),
        buildUser({ id: 'u2', apelido: 'Onça', publicCode: 'XYZ-1' }),
      ],
    });

    const result = await service.list('group-1', { limit: 20, offset: 0 });
    const byId = new Map(result.items.map((item) => [item.user.id, item.user]));

    expect(byId.get('u1')).toMatchObject({
      displayName: 'Krzysztof Kowalski',
      apelido: 'Gato',
    });
    expect(byId.get('u2')).toMatchObject({
      displayName: 'Onça',
      apelido: 'Onça',
    });
  });

  it('sorts by the display name and paginates after sorting', async () => {
    const { service } = buildService({
      [GroupFollow.name]: [
        { user: { id: 'u1' } },
        { user: { id: 'u2' } },
        { user: { id: 'u3' } },
      ],
      [User.name]: [
        buildUser({ id: 'u1', publicCode: 'C' }),
        buildUser({ id: 'u2', publicCode: 'A' }),
        buildUser({ id: 'u3', publicCode: 'B' }),
      ],
    });

    const result = await service.list('group-1', { limit: 2, offset: 1 });

    expect(result.total).toBe(3);
    expect(result.items.map((item) => item.user.displayName)).toEqual([
      'B',
      'C',
    ]);
  });

  it('shows the formal rank only with a matching active affiliation, else the independent rank, never when hidden', async () => {
    const { service } = buildService({
      [GroupFollow.name]: [
        { user: { id: 'formal' } },
        { user: { id: 'stale' } },
        { user: { id: 'hidden' } },
      ],
      [User.name]: [
        buildUser({
          id: 'formal',
          publicCode: 'A',
          showFormalRank: true,
          showFormalGroup: true,
        }),
        buildUser({
          id: 'stale',
          publicCode: 'B',
          showFormalRank: true,
          showFormalGroup: true,
        }),
        buildUser({ id: 'hidden', publicCode: 'C', showFormalRank: false }),
      ],
      [FormalGroupAffiliation.name]: [
        { user: { id: 'formal' }, group: { id: 'g-formal' } },
        { user: { id: 'stale' }, group: { id: 'g-new' } },
      ],
      [FormalRankAssignment.name]: [
        {
          user: { id: 'formal' },
          sourceGroup: { id: 'g-formal' },
          rank: { name: 'Corda Azul', cordSegments: segments('#0000FF') },
        },
        {
          user: { id: 'stale' },
          sourceGroup: { id: 'g-old' },
          rank: { name: 'Old rank', cordSegments: segments('#000000') },
        },
      ],
      [CustomUserRank.name]: [
        {
          user: { id: 'stale' },
          name: 'Independent',
          cordSegments: segments('#FFFF00'),
        },
      ],
    });

    const result = await service.list('group-1', { limit: 20, offset: 0 });
    const rankById = new Map(
      result.items.map((item) => [item.user.id, item.rank?.name ?? null]),
    );

    expect(rankById.get('formal')).toBe('Corda Azul');
    expect(rankById.get('stale')).toBe('Independent');
    expect(rankById.get('hidden')).toBeNull();
  });
});
