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
import { GroupFollow } from './entities/group-follow.entity';
import { RoleAssignment } from './entities/role-assignment.entity';
import { GroupRole } from './enums/group-role.enum';
import { SectionMembership } from './entities/section-membership.entity';
import { GroupAudienceService } from './group-audience.service';
import type { Group } from './entities/group.entity';
import { CommunityListVisibility } from './enums/community-list-visibility.enum';
import { GroupStatus } from './enums/group-status.enum';
import { GroupPermissionService } from './permissions/group-permission.service';
import type { RoleAssignmentsService } from './role-assignments.service';

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

function buildService(
  rows: Rows,
  access: {
    group?: Partial<Group> | null;
    roles?: GroupRole[] | null;
    counts?: Partial<Record<string, number>>;
  } = {},
) {
  const find = jest.fn((entity: { name: string }) =>
    Promise.resolve(rows[entity.name] ?? []),
  );
  const findOne = jest.fn(() =>
    Promise.resolve(
      access.group === undefined ? { id: 'group-1' } : access.group,
    ),
  );
  const count = jest.fn((entity: { name: string }) =>
    Promise.resolve(access.counts?.[entity.name] ?? 0),
  );
  const em = { find, findOne, count } as unknown as EntityManager;
  const r2 = {
    buildPublicUrl: jest.fn(() => 'https://cdn/avatar'),
  } as unknown as R2StorageService;
  const roleAssignmentsService = {
    resolveAuthorization: jest.fn(() =>
      Promise.resolve(
        access.roles
          ? { roleAssignments: access.roles.map((role) => ({ role })) }
          : null,
      ),
    ),
  } as unknown as RoleAssignmentsService;
  const groupPermissionService = new GroupPermissionService();
  return {
    service: new GroupAudienceService(
      em,
      r2,
      roleAssignmentsService,
      groupPermissionService,
    ),
    find,
  };
}

describe('GroupAudienceService.resolveAccess', () => {
  const publicGroup = {
    id: 'group-1',
    status: GroupStatus.ACTIVE,
    followersVisibility: CommunityListVisibility.PUBLIC,
  };

  it('gives a Group OWNER/ADMIN the full list regardless of the visibility setting', async () => {
    for (const role of [GroupRole.OWNER, GroupRole.ADMIN]) {
      const { service } = buildService(
        {},
        {
          group: {
            ...publicGroup,
            followersVisibility: CommunityListVisibility.PRIVATE,
          },
          roles: [role],
        },
      );
      await expect(service.resolveAccess('group-1', 'viewer')).resolves.toBe(
        'FULL',
      );
    }
  });

  it('lets a Section member or a follower see a PUBLIC list (without membership ids)', async () => {
    const member = buildService(
      {},
      { group: publicGroup, counts: { [SectionMembership.name]: 1 } },
    );
    await expect(
      member.service.resolveAccess('group-1', 'viewer'),
    ).resolves.toBe('PUBLIC');

    const follower = buildService(
      {},
      { group: publicGroup, counts: { [GroupFollow.name]: 1 } },
    );
    await expect(
      follower.service.resolveAccess('group-1', 'viewer'),
    ).resolves.toBe('PUBLIC');
  });

  it('404s a member when the list is PRIVATE, and anyone not tied to the Group', async () => {
    const privateList = buildService(
      {},
      {
        group: {
          ...publicGroup,
          followersVisibility: CommunityListVisibility.PRIVATE,
        },
        counts: { [SectionMembership.name]: 1 },
      },
    );
    await expect(
      privateList.service.resolveAccess('group-1', 'viewer'),
    ).rejects.toMatchObject({
      response: { code: 'GROUP_NOT_FOUND' },
    });

    const stranger = buildService({}, { group: publicGroup });
    await expect(
      stranger.service.resolveAccess('group-1', 'viewer'),
    ).rejects.toMatchObject({
      response: { code: 'GROUP_NOT_FOUND' },
    });
  });

  it('404s a non-admin once the Group is archived (deleted for users)', async () => {
    const { service } = buildService(
      {},
      {
        group: { ...publicGroup, status: GroupStatus.ARCHIVED },
        counts: { [GroupFollow.name]: 1 },
      },
    );
    await expect(
      service.resolveAccess('group-1', 'viewer'),
    ).rejects.toMatchObject({
      response: { code: 'GROUP_NOT_FOUND' },
    });
  });
});

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

  it("always lists the OWNER - the Group's formal member - even with no Section membership or follow", async () => {
    const { service } = buildService({
      [GroupFollow.name]: [{ user: { id: 'f1' } }],
      [RoleAssignment.name]: [{ user: { id: 'owner' } }],
      [User.name]: [
        buildUser({ id: 'owner', publicCode: 'A' }),
        buildUser({ id: 'f1', publicCode: 'B' }),
      ],
    });

    const result = await service.list('group-1', { limit: 20, offset: 0 });

    expect(
      result.items.map((item) => [
        item.user.id,
        item.isOwner,
        item.isMemberThroughSection,
        item.isFollowing,
      ]),
    ).toEqual([
      ['owner', true, false, false],
      ['f1', false, false, true],
    ]);
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

  // Changing the formal Group never hides a rank earned in the previous
  // one - it stays the user's rank until the new Group confirms one.
  it('shows the current formal rank from any Group (incl. a previous one), else the independent rank, never when hidden', async () => {
    const { service } = buildService({
      [GroupFollow.name]: [
        { user: { id: 'formal' } },
        { user: { id: 'previous' } },
        { user: { id: 'independent' } },
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
          id: 'previous',
          publicCode: 'B',
          showFormalRank: true,
          showFormalGroup: true,
        }),
        buildUser({
          id: 'independent',
          publicCode: 'C',
          showFormalRank: true,
          showFormalGroup: true,
        }),
        buildUser({ id: 'hidden', publicCode: 'D', showFormalRank: false }),
      ],
      [FormalRankAssignment.name]: [
        {
          user: { id: 'formal' },
          sourceGroup: { id: 'g-formal' },
          rank: { name: 'Corda Azul', cordSegments: segments('#0000FF') },
        },
        {
          user: { id: 'previous' },
          sourceGroup: { id: 'g-old' },
          rank: { name: 'Old rank', cordSegments: segments('#000000') },
        },
      ],
      [CustomUserRank.name]: [
        {
          user: { id: 'independent' },
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
    expect(rankById.get('previous')).toBe('Old rank');
    expect(rankById.get('independent')).toBe('Independent');
    expect(rankById.get('hidden')).toBeNull();
  });
});
