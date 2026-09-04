import { PublicUrlBuilder } from '../../storage/image-url.util';
import { SectionMembership } from '../entities/section-membership.entity';
import { Group } from '../entities/group.entity';
import { Section } from '../entities/section.entity';
import { RoleAssignment } from '../entities/role-assignment.entity';
import { SectionMembershipStatus } from '../enums/section-membership-status.enum';
import { GroupRole } from '../enums/group-role.enum';
import { GroupStatus } from '../enums/group-status.enum';
import { MembershipEndReason } from '../enums/membership-end-reason.enum';
import {
  toSectionMembershipResponseDto,
  toGroupResponseDto,
  toGroupSummaryResponseDto,
  toRoleAssignmentResponseDto,
} from './group.mapper';

function buildUrlBuilder(): PublicUrlBuilder {
  return { buildPublicUrl: (key) => `https://cdn.example.com/${key}` };
}

function buildGroup(overrides: Partial<Group> = {}): Group {
  const group = new Group();
  group.id = 'group-1';
  group.name = 'Capoeira Angola SP';
  group.isPublic = true;
  group.isHidden = false;
  group.memberInvitesAllowed = false;
  group.publicCode = 'ABCD-1234';
  group.status = GroupStatus.ACTIVE;
  return Object.assign(group, overrides);
}

function buildSection(overrides: Partial<Section> = {}): Section {
  const section = new Section();
  section.id = 'section-1';
  section.name = 'Capoeira Angola SP - Kids';
  section.isPublic = true;
  section.isHidden = false;
  section.memberInvitesAllowed = false;
  section.publicCode = 'ABCD-KIDS';
  section.status = GroupStatus.ACTIVE;
  section.timezone = 'Europe/Warsaw';
  section.currencyCode = 'PLN';
  return Object.assign(section, overrides);
}

describe('group.mapper', () => {
  describe('toGroupResponseDto', () => {
    it('maps every field, including timestamps as ISO strings', () => {
      const group = buildGroup({ logoUrl: 'https://example.com/logo.png' });

      const dto = toGroupResponseDto(
        group,
        { childGroupsCount: 2, directSectionsCount: 3 },
        buildUrlBuilder(),
      );

      expect(dto).toMatchObject({
        id: 'group-1',
        parentGroupId: null,
        name: 'Capoeira Angola SP',
        logoUrl: 'https://example.com/logo.png',
        isPublic: true,
        isHidden: false,
        publicCode: 'ABCD-1234',
        status: GroupStatus.ACTIVE,
        childGroupsCount: 2,
        directSectionsCount: 3,
      });
      expect(dto.createdAt).toBe(group.createdAt.toISOString());
      expect(dto.updatedAt).toBe(group.updatedAt.toISOString());
    });

    it('prefers the R2 public URL derived from profileImageKey over the legacy logoUrl', () => {
      const group = buildGroup({
        logoUrl: 'https://legacy.example.com/old-logo.png',
        profileImageKey: 'groups/group-1/profile/uuid.webp',
      });

      const dto = toGroupResponseDto(
        group,
        { childGroupsCount: 0, directSectionsCount: 0 },
        buildUrlBuilder(),
      );

      expect(dto.logoUrl).toBe(
        'https://cdn.example.com/groups/group-1/profile/uuid.webp',
      );
    });

    it('falls back to the legacy logoUrl when profileImageKey is unset', () => {
      const group = buildGroup({
        logoUrl: 'https://legacy.example.com/old-logo.png',
      });

      const dto = toGroupResponseDto(
        group,
        { childGroupsCount: 0, directSectionsCount: 0 },
        buildUrlBuilder(),
      );

      expect(dto.logoUrl).toBe('https://legacy.example.com/old-logo.png');
    });

    it('prefers the R2 public URL derived from coverImageKey over the legacy coverImageUrl', () => {
      const group = buildGroup({
        coverImageUrl: 'https://legacy.example.com/old-cover.png',
        coverImageKey: 'groups/group-1/cover/uuid.webp',
      });

      const dto = toGroupResponseDto(
        group,
        { childGroupsCount: 0, directSectionsCount: 0 },
        buildUrlBuilder(),
      );

      expect(dto.coverImageUrl).toBe(
        'https://cdn.example.com/groups/group-1/cover/uuid.webp',
      );
    });

    it('falls back to the legacy coverImageUrl when coverImageKey is unset', () => {
      const group = buildGroup({
        coverImageUrl: 'https://legacy.example.com/old-cover.png',
      });

      const dto = toGroupResponseDto(
        group,
        { childGroupsCount: 0, directSectionsCount: 0 },
        buildUrlBuilder(),
      );

      expect(dto.coverImageUrl).toBe('https://legacy.example.com/old-cover.png');
    });
  });

  describe('toGroupSummaryResponseDto', () => {
    it('embeds every Role the caller holds for the Group alongside the group card fields', () => {
      const group = buildGroup();

      const dto = toGroupSummaryResponseDto(
        group,
        [GroupRole.ADMIN, GroupRole.OWNER],
        buildUrlBuilder(),
      );

      expect(dto).toEqual({
        id: 'group-1',
        name: 'Capoeira Angola SP',
        logoUrl: null,
        isPublic: true,
        isHidden: false,
        publicCode: 'ABCD-1234',
        status: GroupStatus.ACTIVE,
        myRoles: [GroupRole.ADMIN, GroupRole.OWNER],
      });
    });

    it('sets myRoles to an empty array when no Role Assignment exists for the group', () => {
      const group = buildGroup();

      const dto = toGroupSummaryResponseDto(group, [], buildUrlBuilder());

      expect(dto.myRoles).toEqual([]);
    });
  });

  describe('toSectionMembershipResponseDto', () => {
    it('maps the membership, every Role it holds for the Section, its minimal user reference, and assigned cohorts', () => {
      const membership = new SectionMembership();
      membership.id = 'membership-1';
      membership.section = buildSection({ id: 'section-1' });
      membership.user = {
        id: 'user-1',
        displayName: 'Mestre Bimba',
      } as never;
      membership.status = SectionMembershipStatus.ACTIVE;
      membership.joinedAt = new Date('2026-01-01T00:00:00.000Z');
      membership.leftAt = null;
      membership.endReason = null;
      membership.endedBy = null;

      const dto = toSectionMembershipResponseDto(
        membership,
        [GroupRole.MEMBER, GroupRole.OWNER],
        [{ id: 'cohort-1', name: 'Kids' }],
      );

      expect(dto).toEqual({
        id: 'membership-1',
        sectionId: 'section-1',
        user: { id: 'user-1', displayName: 'Mestre Bimba' },
        roles: [GroupRole.MEMBER, GroupRole.OWNER],
        status: SectionMembershipStatus.ACTIVE,
        joinedAt: '2026-01-01T00:00:00.000Z',
        leftAt: null,
        endReason: null,
        endedBy: null,
        cohorts: [{ id: 'cohort-1', name: 'Kids' }],
      });
    });

    it('maps leftAt, endReason and endedBy once the membership has ended', () => {
      const membership = new SectionMembership();
      membership.id = 'membership-1';
      membership.section = buildSection({ id: 'section-1' });
      membership.user = { id: 'user-1', displayName: 'Mestre Bimba' } as never;
      membership.status = SectionMembershipStatus.ARCHIVED;
      membership.joinedAt = new Date('2026-01-01T00:00:00.000Z');
      membership.leftAt = new Date('2026-02-01T00:00:00.000Z');
      membership.endReason = MembershipEndReason.LEFT;
      membership.endedBy = {
        id: 'user-1',
        displayName: 'Mestre Bimba',
      } as never;

      const dto = toSectionMembershipResponseDto(
        membership,
        [GroupRole.MEMBER],
        [],
      );

      expect(dto.leftAt).toBe('2026-02-01T00:00:00.000Z');
      expect(dto.endReason).toBe(MembershipEndReason.LEFT);
      expect(dto.endedBy).toEqual({
        id: 'user-1',
        displayName: 'Mestre Bimba',
      });
    });

    it('sets roles to an empty array when passed none, and endedBy to null when the membership never ended', () => {
      const membership = new SectionMembership();
      membership.id = 'membership-1';
      membership.section = buildSection({ id: 'section-1' });
      membership.user = { id: 'user-1', displayName: 'Mestre Bimba' } as never;
      membership.status = SectionMembershipStatus.ACTIVE;
      membership.joinedAt = new Date('2026-01-01T00:00:00.000Z');
      membership.leftAt = null;
      membership.endReason = null;
      membership.endedBy = null;

      const dto = toSectionMembershipResponseDto(membership, [], []);

      expect(dto.roles).toEqual([]);
      expect(dto.endedBy).toBeNull();
    });
  });

  describe('toRoleAssignmentResponseDto', () => {
    it('maps a Role Assignment, including the exact target it applies to, directly off `user` (no membership relation)', () => {
      const roleAssignment = new RoleAssignment();
      roleAssignment.id = 'role-assignment-1';
      roleAssignment.group = buildGroup({ id: 'group-1' });
      roleAssignment.role = GroupRole.ADMIN;
      roleAssignment.grantedAt = new Date('2026-01-01T00:00:00.000Z');
      roleAssignment.user = {
        id: 'user-1',
        displayName: 'Mestre Bimba',
      } as never;
      roleAssignment.grantedBy = {
        id: 'owner-1',
        displayName: 'Ana Silva',
      } as never;
      roleAssignment.revokedAt = null;
      roleAssignment.revokedBy = null;

      const dto = toRoleAssignmentResponseDto(roleAssignment);

      expect(dto).toEqual({
        id: 'role-assignment-1',
        groupId: 'group-1',
        user: { id: 'user-1', displayName: 'Mestre Bimba' },
        role: GroupRole.ADMIN,
        grantedAt: '2026-01-01T00:00:00.000Z',
        grantedBy: { id: 'owner-1', displayName: 'Ana Silva' },
        revokedAt: null,
        revokedBy: null,
      });
    });

    it('maps revokedAt/revokedBy once the role has been revoked', () => {
      const roleAssignment = new RoleAssignment();
      roleAssignment.id = 'role-assignment-1';
      roleAssignment.section = buildSection({ id: 'section-1' });
      roleAssignment.role = GroupRole.INSTRUCTOR;
      roleAssignment.grantedAt = new Date('2026-01-01T00:00:00.000Z');
      roleAssignment.user = {
        id: 'user-1',
        displayName: 'Mestre Bimba',
      } as never;
      roleAssignment.grantedBy = null;
      roleAssignment.revokedAt = new Date('2026-03-01T00:00:00.000Z');
      roleAssignment.revokedBy = {
        id: 'owner-1',
        displayName: 'Ana Silva',
      } as never;

      const dto = toRoleAssignmentResponseDto(roleAssignment);

      expect(dto.groupId).toBe('section-1');
      expect(dto.grantedBy).toBeNull();
      expect(dto.revokedAt).toBe('2026-03-01T00:00:00.000Z');
      expect(dto.revokedBy).toEqual({
        id: 'owner-1',
        displayName: 'Ana Silva',
      });
    });
  });
});
