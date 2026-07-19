import { GroupMembership } from '../entities/group-membership.entity';
import { Group } from '../entities/group.entity';
import { GroupMembershipStatus } from '../enums/group-membership-status.enum';
import { GroupRole } from '../enums/group-role.enum';
import { GroupStatus } from '../enums/group-status.enum';
import { GroupVisibility } from '../enums/group-visibility.enum';
import {
  toGroupMembershipResponseDto,
  toGroupResponseDto,
  toGroupSummaryResponseDto,
} from './group.mapper';

function buildGroup(overrides: Partial<Group> = {}): Group {
  const group = new Group();
  group.id = 'group-1';
  group.name = 'Capoeira Angola SP';
  group.visibility = GroupVisibility.PUBLIC;
  group.status = GroupStatus.ACTIVE;
  group.timezone = 'Europe/Warsaw';
  group.currencyCode = 'PLN';
  return Object.assign(group, overrides);
}

describe('group.mapper', () => {
  describe('toGroupResponseDto', () => {
    it('maps every field, including timestamps as ISO strings', () => {
      const group = buildGroup({ logoUrl: 'https://example.com/logo.png' });

      const dto = toGroupResponseDto(group);

      expect(dto).toMatchObject({
        id: 'group-1',
        name: 'Capoeira Angola SP',
        logoUrl: 'https://example.com/logo.png',
        visibility: GroupVisibility.PUBLIC,
        status: GroupStatus.ACTIVE,
        timezone: 'Europe/Warsaw',
        currencyCode: 'PLN',
      });
      expect(dto.createdAt).toBe(group.createdAt.toISOString());
      expect(dto.updatedAt).toBe(group.updatedAt.toISOString());
    });
  });

  describe('toGroupSummaryResponseDto', () => {
    it('embeds the caller-specific myRole alongside the group card fields', () => {
      const group = buildGroup();

      const dto = toGroupSummaryResponseDto(group, GroupRole.ADMIN);

      expect(dto).toEqual({
        id: 'group-1',
        name: 'Capoeira Angola SP',
        logoUrl: null,
        visibility: GroupVisibility.PUBLIC,
        status: GroupStatus.ACTIVE,
        myRole: GroupRole.ADMIN,
      });
    });
  });

  describe('toGroupMembershipResponseDto', () => {
    it('maps the membership and its minimal user reference', () => {
      const membership = new GroupMembership();
      membership.id = 'membership-1';
      membership.user = {
        id: 'user-1',
        displayName: 'Mestre Bimba',
      } as never;
      membership.role = GroupRole.OWNER;
      membership.status = GroupMembershipStatus.ACTIVE;
      membership.joinedAt = new Date('2026-01-01T00:00:00.000Z');
      membership.leftAt = null;

      const dto = toGroupMembershipResponseDto(membership);

      expect(dto).toEqual({
        id: 'membership-1',
        user: { id: 'user-1', displayName: 'Mestre Bimba' },
        role: GroupRole.OWNER,
        status: GroupMembershipStatus.ACTIVE,
        joinedAt: '2026-01-01T00:00:00.000Z',
        leftAt: null,
      });
    });

    it('maps leftAt to an ISO string when set', () => {
      const membership = new GroupMembership();
      membership.id = 'membership-1';
      membership.user = { id: 'user-1', displayName: 'Mestre Bimba' } as never;
      membership.role = GroupRole.MEMBER;
      membership.status = GroupMembershipStatus.LEFT;
      membership.joinedAt = new Date('2026-01-01T00:00:00.000Z');
      membership.leftAt = new Date('2026-02-01T00:00:00.000Z');

      const dto = toGroupMembershipResponseDto(membership);

      expect(dto.leftAt).toBe('2026-02-01T00:00:00.000Z');
    });
  });
});
