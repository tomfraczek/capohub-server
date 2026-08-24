import { NotFoundException } from '@nestjs/common';
import type { EntityManager } from '@mikro-orm/postgresql';
import { User } from '../users/entities/user.entity';
import { CreateGroupInput } from './dto/create-group.schema';
import { Group } from './entities/group.entity';
import { Section } from './entities/section.entity';
import { RoleAssignment } from './entities/role-assignment.entity';
import { GroupRole } from './enums/group-role.enum';
import { GroupStatus } from './enums/group-status.enum';
import { ImageAssetService } from '../storage/image-asset.service';
import { ImageProcessingService } from '../storage/image-processing.service';
import { R2StorageService } from '../storage/r2-storage.service';
import { AuditLogService } from './audit-log.service';
import { GroupHierarchyService } from './group-hierarchy.service';
import { GroupsService } from './groups.service';
import { RoleAssignmentsService } from './role-assignments.service';

function buildCreateInput(
  overrides: Partial<CreateGroupInput> = {},
): CreateGroupInput {
  return {
    name: 'Capoeira Angola SP',
    description: null,
    logoUrl: null,
    coverImageUrl: null,
    contactEmail: null,
    contactPhone: null,
    websiteUrl: null,
    facebookUrl: null,
    instagramUrl: null,
    youtubeUrl: null,
    isPublic: true,
    isHidden: false,
    memberInvitesAllowed: false,
    timezone: 'Europe/Warsaw',
    currencyCode: 'PLN',
    ...overrides,
  };
}

function buildUser(overrides: Partial<User> = {}): User {
  const user = new User();
  user.id = 'user-1';
  return Object.assign(user, overrides);
}

function buildGroup(overrides: Partial<Group> = {}): Group {
  const group = new Group();
  group.id = 'group-1';
  group.name = 'Capoeira Angola SP';
  group.status = GroupStatus.ACTIVE;
  group.parentGroup = null;
  return Object.assign(group, overrides);
}

function buildRoleAssignment(
  overrides: Partial<RoleAssignment> = {},
): RoleAssignment {
  const assignment = new RoleAssignment();
  assignment.id = 'role-assignment-1';
  assignment.role = GroupRole.MEMBER;
  assignment.user = buildUser();
  assignment.group = buildGroup({ id: 'parent-1' });
  assignment.grantedAt = new Date('2026-01-01T00:00:00.000Z');
  return Object.assign(assignment, overrides);
}

interface MockRouting {
  groupResults?: (Group | null)[];
  roleAssignmentResults?: (RoleAssignment | null)[];
  roleAssignmentFindResults?: RoleAssignment[];
  groupFindResults?: Group[];
  children?: Group[];
  sections?: Section[];
}

function buildMockEm(routing: MockRouting = {}) {
  const groupQueue = [...(routing.groupResults ?? [])];
  const roleAssignmentQueue = [...(routing.roleAssignmentResults ?? [])];

  const flush = jest.fn().mockResolvedValue(undefined);
  const persist = jest
    .fn<{ flush: jest.Mock }, [object]>()
    .mockReturnValue({ flush });

  const findOne = jest.fn((entity: unknown, filter?: unknown) => {
    // publicCode uniqueness check from generateUniquePublicCode() - always
    // return null to indicate no collision regardless of entity type.
    if (
      filter !== null &&
      typeof filter === 'object' &&
      'publicCode' in (filter as Record<string, unknown>)
    ) {
      return Promise.resolve(null);
    }
    if (entity === Group) {
      return Promise.resolve(groupQueue.shift() ?? null);
    }
    if (entity === RoleAssignment) {
      return Promise.resolve(roleAssignmentQueue.shift() ?? null);
    }
    // User lookups come from generateUniquePublicCode() - return null
    // to indicate "no existing user has this publicCode".
    if (entity === User) {
      return Promise.resolve(null);
    }
    throw new Error(
      `Unexpected findOne entity in test mock: ${String(entity)}`,
    );
  });

  const find = jest.fn((entity: unknown) => {
    if (entity === RoleAssignment) {
      return Promise.resolve(routing.roleAssignmentFindResults ?? []);
    }
    if (entity === Group) {
      return Promise.resolve(
        routing.groupFindResults ?? routing.children ?? [],
      );
    }
    if (entity === Section) {
      return Promise.resolve(routing.sections ?? []);
    }
    throw new Error(`Unexpected find entity in test mock: ${String(entity)}`);
  });

  const count = jest.fn().mockResolvedValue(0);

  const raw = {
    findOne,
    find,
    count,
    persist,
    flush,
    transactional: jest
      .fn()
      .mockImplementation((cb: (em: EntityManager) => unknown) =>
        cb(raw as never),
      ),
  };

  return { em: raw as unknown as EntityManager, persist, findOne, find };
}

function buildService(em: EntityManager) {
  const groupHierarchyService = {
    getRootGroup: () => Promise.resolve(buildGroup()),
  } as unknown as GroupHierarchyService;
  const auditLogService = {
    record: jest.fn().mockResolvedValue(undefined),
  } as unknown as AuditLogService;
  const roleAssignmentsService = new RoleAssignmentsService(
    em,
    groupHierarchyService,
    auditLogService,
  );
  const r2StorageService = {
    buildPublicUrl: (key: string) => `https://cdn.example.com/${key}`,
  } as unknown as R2StorageService;
  const imageProcessingService = {
    processProfileImage: jest.fn().mockResolvedValue(Buffer.from('webp')),
  } as unknown as ImageProcessingService;
  // Not cast to ImageAssetService directly (unlike the mocks above) - tests
  // read `imageAssetService.replace`/`.remove` back off the returned object
  // to assert on them, and casting to the real class type there trips
  // @typescript-eslint/unbound-method (see event-roles.service.spec.ts's
  // identical fix in the "Event Organizer" module for the same reason).
  const imageAssetService = {
    replace: jest
      .fn()
      .mockImplementation(
        async (params: {
          newKey: string;
          persist: (key: string) => Promise<void>;
        }) => params.persist(params.newKey),
      ),
    remove: jest
      .fn()
      .mockImplementation(
        async (params: {
          oldKey: string | null;
          persist: () => Promise<void>;
        }) => (params.oldKey ? params.persist() : undefined),
      ),
  };

  return {
    service: new GroupsService(
      em,
      roleAssignmentsService,
      auditLogService,
      r2StorageService,
      imageProcessingService,
      imageAssetService as unknown as ImageAssetService,
    ),
    auditLogService,
    imageAssetService,
  };
}

describe('GroupsService', () => {
  describe('create', () => {
    it('creates a Root Group and grants the creator OWNER directly - no membership, no MEMBER role at all', async () => {
      const { em, persist } = buildMockEm();
      const { service } = buildService(em);
      const user = buildUser();

      await service.create(user, buildCreateInput());

      const persistedGroup = persist.mock.calls[0][0] as Group;
      expect(persistedGroup).toBeInstanceOf(Group);
      expect(persistedGroup.name).toBe('Capoeira Angola SP');
      expect(persistedGroup.parentGroup).toBeNull();

      // insertRoleAssignment is the only other persist() call - a single
      // OWNER RoleAssignment, no membership, no MEMBER.
      const persistedOwnerRole = persist.mock.calls[1][0] as RoleAssignment;
      expect(persistedOwnerRole.role).toBe(GroupRole.OWNER);
      expect(persistedOwnerRole.user).toBe(user);
      expect(persistedOwnerRole.group).toBe(persistedGroup);
      expect(persist).toHaveBeenCalledTimes(2);
    });
  });

  describe('listMine', () => {
    it('maps each Group the user holds any Role for to a summary with myRoles set from that Role Assignment', async () => {
      const rootGroup = buildGroup({ id: 'group-1', name: 'Grupo Axé' });
      const { em } = buildMockEm({
        roleAssignmentFindResults: [
          buildRoleAssignment({ group: rootGroup, role: GroupRole.ADMIN }),
          buildRoleAssignment({ group: rootGroup, role: GroupRole.OWNER }),
        ],
        groupFindResults: [rootGroup],
      });
      const { service } = buildService(em);

      const result = await service.listMine('user-1');

      expect(result).toEqual([
        expect.objectContaining({
          name: 'Grupo Axé',
          myRoles: [GroupRole.ADMIN, GroupRole.OWNER],
        }),
      ]);
    });

    it('returns an empty array when the user holds no Role Assignment anywhere', async () => {
      const { em, find } = buildMockEm({ roleAssignmentFindResults: [] });
      const { service } = buildService(em);

      const result = await service.listMine('user-1');

      expect(result).toEqual([]);
      // No RoleAssignment participation at all - never even queries Group.
      expect(find).not.toHaveBeenCalledWith(
        Group,
        expect.anything(),
        expect.anything(),
      );
    });

    it('includes groups with status ARCHIVED - archiving never touches RoleAssignments', async () => {
      const rootGroup = buildGroup({
        id: 'group-1',
        name: 'Archived Group',
        status: GroupStatus.ARCHIVED,
      });
      const { em } = buildMockEm({
        roleAssignmentFindResults: [
          buildRoleAssignment({ group: rootGroup, role: GroupRole.OWNER }),
        ],
        groupFindResults: [rootGroup],
      });
      const { service } = buildService(em);

      const result = await service.listMine('user-1');

      expect(result).toEqual([
        expect.objectContaining({
          name: 'Archived Group',
          status: GroupStatus.ARCHIVED,
        }),
      ]);
    });

    it('never includes a Section id in the Group list - participation rows that resolve to a Section are filtered out', async () => {
      // getGroupParticipationForUsers returns every target (Group or
      // Section) the user holds a role for - listMine only ever queries
      // Group by those ids, so a Section-only participation row simply
      // finds no match and is dropped.
      const { em } = buildMockEm({
        roleAssignmentFindResults: [
          buildRoleAssignment({
            group: null,
            section: Object.assign({}, { id: 'section-1' }) as never,
            role: GroupRole.MEMBER,
          }),
        ],
        groupFindResults: [],
      });
      const { service } = buildService(em);

      const result = await service.listMine('user-1');

      expect(result).toEqual([]);
    });
  });

  describe('getById', () => {
    it('throws NotFoundException when the group does not exist', async () => {
      const { em } = buildMockEm({ groupResults: [null] });
      const { service } = buildService(em);

      await expect(service.getById('missing-id')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('update', () => {
    it('applies every field from the input', async () => {
      const existing = buildGroup({ name: 'Old Name' });
      const { em } = buildMockEm({ groupResults: [existing] });
      const { service } = buildService(em);

      await service.update(
        'group-1',
        buildCreateInput({ name: 'New Name' }),
        buildUser(),
      );

      expect(existing.name).toBe('New Name');
    });
  });

  describe('uploadProfileImage', () => {
    function buildUploadedFile(): Express.Multer.File {
      return { buffer: Buffer.from('raw-bytes') } as Express.Multer.File;
    }

    it('processes the file, uploads it under a fresh key, sets profileImageKey and clears the legacy logoUrl', async () => {
      const existing = buildGroup({
        id: 'group-1',
        logoUrl: 'https://legacy.example.com/old-logo.png',
      });
      const { em } = buildMockEm({ groupResults: [existing] });
      const { service } = buildService(em);

      const dto = await service.uploadProfileImage(
        'group-1',
        buildUploadedFile(),
      );

      expect(existing.profileImageKey).toMatch(
        /^groups\/group-1\/profile\/.+\.webp$/,
      );
      expect(existing.logoUrl).toBeNull();
      expect(dto.logoUrl).toBe(
        `https://cdn.example.com/${existing.profileImageKey}`,
      );
    });

    it('passes the previous profileImageKey as oldKey to ImageAssetService.replace', async () => {
      const existing = buildGroup({
        id: 'group-1',
        profileImageKey: 'groups/group-1/profile/old.webp',
      });
      const { em } = buildMockEm({ groupResults: [existing] });
      const { service, imageAssetService } = buildService(em);

      await service.uploadProfileImage('group-1', buildUploadedFile());

      expect(imageAssetService.replace).toHaveBeenCalledWith(
        expect.objectContaining({
          oldKey: 'groups/group-1/profile/old.webp',
          logContext: {
            resourceType: 'group-profile-image',
            resourceId: 'group-1',
          },
        }),
      );
    });

    it('throws NotFoundException when the group does not exist', async () => {
      const { em } = buildMockEm({ groupResults: [null] });
      const { service } = buildService(em);

      await expect(
        service.uploadProfileImage('missing-id', buildUploadedFile()),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('deleteProfileImage', () => {
    it('clears profileImageKey and does not restore the legacy logoUrl', async () => {
      const existing = buildGroup({
        id: 'group-1',
        logoUrl: null,
        profileImageKey: 'groups/group-1/profile/old.webp',
      });
      const { em } = buildMockEm({ groupResults: [existing] });
      const { service } = buildService(em);

      const dto = await service.deleteProfileImage('group-1');

      expect(existing.profileImageKey).toBeNull();
      expect(dto.logoUrl).toBeNull();
    });

    it('is idempotent when there is no profile image to delete', async () => {
      const existing = buildGroup({ id: 'group-1', profileImageKey: null });
      const { em } = buildMockEm({ groupResults: [existing] });
      const { service, imageAssetService } = buildService(em);

      await service.deleteProfileImage('group-1');

      expect(imageAssetService.remove).toHaveBeenCalledWith(
        expect.objectContaining({ oldKey: null }),
      );
    });
  });

  // Whether a transition is actually allowed from the group's current
  // status is decided by GroupPermissionsGuard before these ever run (see
  // group-write-policy.ts) - these methods just apply the target status, so
  // the tests only check that.
  describe('archive', () => {
    it('sets status to ARCHIVED', async () => {
      const existing = buildGroup({ status: GroupStatus.ACTIVE });
      const { em } = buildMockEm({ groupResults: [existing] });
      const { service } = buildService(em);

      await service.archive('group-1', buildUser());

      expect(existing.status).toBe(GroupStatus.ARCHIVED);
    });

    it('throws NotFoundException when the group does not exist', async () => {
      const { em } = buildMockEm({ groupResults: [null] });
      const { service } = buildService(em);

      await expect(
        service.archive('missing-id', buildUser()),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('unarchive', () => {
    it('sets status back to ACTIVE', async () => {
      const existing = buildGroup({ status: GroupStatus.ARCHIVED });
      const { em } = buildMockEm({ groupResults: [existing] });
      const { service } = buildService(em);

      await service.unarchive('group-1', buildUser());

      expect(existing.status).toBe(GroupStatus.ACTIVE);
    });
  });

  describe('setReadOnly', () => {
    it('sets status to READ_ONLY', async () => {
      const existing = buildGroup({ status: GroupStatus.ACTIVE });
      const { em } = buildMockEm({ groupResults: [existing] });
      const { service } = buildService(em);

      await service.setReadOnly('group-1', buildUser());

      expect(existing.status).toBe(GroupStatus.READ_ONLY);
    });
  });

  describe('activate', () => {
    it('sets status to ACTIVE', async () => {
      const existing = buildGroup({ status: GroupStatus.READ_ONLY });
      const { em } = buildMockEm({ groupResults: [existing] });
      const { service } = buildService(em);

      await service.activate('group-1', buildUser());

      expect(existing.status).toBe(GroupStatus.ACTIVE);
    });
  });

  describe('delete', () => {
    it('sets status to DELETED', async () => {
      const existing = buildGroup({ status: GroupStatus.ACTIVE });
      const { em } = buildMockEm({ groupResults: [existing], children: [] });
      const { service } = buildService(em);

      await service.delete('group-1', buildUser());

      expect(existing.status).toBe(GroupStatus.DELETED);
    });

    it('rejects when a child group is not already ARCHIVED or DELETED', async () => {
      const existing = buildGroup({ status: GroupStatus.ACTIVE });
      const activeChild = buildGroup({
        id: 'child-1',
        status: GroupStatus.ACTIVE,
      });
      const { em } = buildMockEm({
        groupResults: [existing],
        children: [activeChild],
      });
      const { service } = buildService(em);

      await expect(
        service.delete('group-1', buildUser()),
      ).rejects.toMatchObject({
        response: { code: 'GROUP_HAS_ACTIVE_CHILDREN' },
      });
    });

    it('allows deletion when every child is already ARCHIVED', async () => {
      const existing = buildGroup({ status: GroupStatus.ACTIVE });
      const archivedChild = buildGroup({
        id: 'child-1',
        status: GroupStatus.ARCHIVED,
      });
      const { em } = buildMockEm({
        groupResults: [existing],
        children: [archivedChild],
      });
      const { service } = buildService(em);

      await service.delete('group-1', buildUser());

      expect(existing.status).toBe(GroupStatus.DELETED);
    });
  });
});
