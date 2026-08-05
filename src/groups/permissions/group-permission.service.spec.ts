import { SectionMembershipStatus } from '../enums/section-membership-status.enum';
import { GroupRole } from '../enums/group-role.enum';
import { GroupPermission } from './group-permission.enum';
import { GroupPermissionService } from './group-permission.service';

describe('GroupPermissionService', () => {
  let service: GroupPermissionService;

  beforeEach(() => {
    service = new GroupPermissionService();
  });

  describe('hasPermission (SECTION target)', () => {
    it('returns true when the role has the permission', () => {
      expect(
        service.hasPermission(
          'SECTION',
          GroupRole.MEMBER,
          GroupPermission.GROUP_VIEW,
        ),
      ).toBe(true);
    });

    it('returns false when the role lacks the permission', () => {
      expect(
        service.hasPermission(
          'SECTION',
          GroupRole.MEMBER,
          GroupPermission.GROUP_EDIT,
        ),
      ).toBe(false);
    });

    it('returns true for a permission inherited from a lower tier', () => {
      expect(
        service.hasPermission(
          'SECTION',
          GroupRole.OWNER,
          GroupPermission.GROUP_VIEW,
        ),
      ).toBe(true);
    });

    it('withholds every lifecycle-status and ownership-transfer permission from ADMIN', () => {
      expect(
        service.hasPermission(
          'SECTION',
          GroupRole.ADMIN,
          GroupPermission.GROUP_ARCHIVE,
        ),
      ).toBe(false);
      expect(
        service.hasPermission(
          'SECTION',
          GroupRole.ADMIN,
          GroupPermission.GROUP_UNARCHIVE,
        ),
      ).toBe(false);
      expect(
        service.hasPermission(
          'SECTION',
          GroupRole.ADMIN,
          GroupPermission.GROUP_SET_READ_ONLY,
        ),
      ).toBe(false);
      expect(
        service.hasPermission(
          'SECTION',
          GroupRole.ADMIN,
          GroupPermission.GROUP_ACTIVATE,
        ),
      ).toBe(false);
      expect(
        service.hasPermission(
          'SECTION',
          GroupRole.ADMIN,
          GroupPermission.GROUP_OWNERSHIP_TRANSFER,
        ),
      ).toBe(false);
    });

    it('grants ADMIN the membership-, academy- and cohort-management permissions', () => {
      expect(
        service.hasPermission(
          'SECTION',
          GroupRole.ADMIN,
          GroupPermission.MEMBERSHIP_ADD,
        ),
      ).toBe(true);
      expect(
        service.hasPermission(
          'SECTION',
          GroupRole.ADMIN,
          GroupPermission.MEMBERSHIP_ROLE_CHANGE,
        ),
      ).toBe(true);
      expect(
        service.hasPermission(
          'SECTION',
          GroupRole.ADMIN,
          GroupPermission.MEMBERSHIP_REMOVE,
        ),
      ).toBe(true);
      expect(
        service.hasPermission(
          'SECTION',
          GroupRole.ADMIN,
          GroupPermission.MEMBERSHIP_COHORT_ASSIGN,
        ),
      ).toBe(true);
      expect(
        service.hasPermission(
          'SECTION',
          GroupRole.ADMIN,
          GroupPermission.ACADEMY_CREATE,
        ),
      ).toBe(true);
      expect(
        service.hasPermission(
          'SECTION',
          GroupRole.ADMIN,
          GroupPermission.COHORT_CREATE,
        ),
      ).toBe(true);
    });

    it('gives INSTRUCTOR and ASSISTANT the same permissions as MEMBER', () => {
      expect(
        service.getPermissionsForRole('SECTION', GroupRole.INSTRUCTOR),
      ).toEqual(service.getPermissionsForRole('SECTION', GroupRole.MEMBER));
      expect(
        service.getPermissionsForRole('SECTION', GroupRole.ASSISTANT),
      ).toEqual(service.getPermissionsForRole('SECTION', GroupRole.MEMBER));
    });
  });

  describe('GROUP target - no membership-lifecycle permissions, only OWNER/ADMIN', () => {
    it('grants nothing to MEMBER/INSTRUCTOR/ASSISTANT - Group has no such roles', () => {
      expect(service.getPermissionsForRole('GROUP', GroupRole.MEMBER)).toEqual(
        [],
      );
      expect(
        service.getPermissionsForRole('GROUP', GroupRole.INSTRUCTOR),
      ).toEqual([]);
      expect(
        service.getPermissionsForRole('GROUP', GroupRole.ASSISTANT),
      ).toEqual([]);
    });

    it('never grants membership-lifecycle permissions to ADMIN or OWNER', () => {
      const membershipLifecyclePermissions = [
        GroupPermission.MEMBERSHIP_ADD,
        GroupPermission.MEMBERSHIP_ROLE_CHANGE,
        GroupPermission.MEMBERSHIP_REMOVE,
        GroupPermission.MEMBERSHIP_COHORT_ASSIGN,
        GroupPermission.MEMBERSHIP_BAN,
        GroupPermission.MEMBERSHIP_UNBAN,
        GroupPermission.MEMBERSHIP_SUSPEND,
        GroupPermission.MEMBERSHIP_UNSUSPEND,
        GroupPermission.MEMBERSHIP_INVITE,
        GroupPermission.MEMBERSHIP_REQUEST_REVIEW,
        GroupPermission.GROUP_INVITE,
        GroupPermission.GROUP_JOIN_REQUEST_REVIEW,
      ];
      for (const permission of membershipLifecyclePermissions) {
        expect(
          service.hasPermission('GROUP', GroupRole.ADMIN, permission),
        ).toBe(false);
        expect(
          service.hasPermission('GROUP', GroupRole.OWNER, permission),
        ).toBe(false);
      }
    });

    it('still grants ADMIN/OWNER the administrative capabilities that do apply to a Group', () => {
      expect(
        service.hasPermission(
          'GROUP',
          GroupRole.ADMIN,
          GroupPermission.GROUP_EDIT,
        ),
      ).toBe(true);
      expect(
        service.hasPermission(
          'GROUP',
          GroupRole.ADMIN,
          GroupPermission.SECTION_CREATE,
        ),
      ).toBe(true);
      expect(
        service.hasPermission(
          'GROUP',
          GroupRole.OWNER,
          GroupPermission.GROUP_ARCHIVE,
        ),
      ).toBe(true);
      expect(
        service.hasPermission(
          'GROUP',
          GroupRole.ADMIN,
          GroupPermission.GROUP_ARCHIVE,
        ),
      ).toBe(false);
    });

    it('has no membership-status gating at all - ACTIVE/READ_ONLY/etc are irrelevant, only the RoleAssignment matters', () => {
      // membershipStatus is always null for a Group target - the union of
      // permissions is unconditionally granted.
      expect(
        service.hasAllPermissionsForRoles(
          'GROUP',
          [GroupRole.OWNER],
          [GroupPermission.GROUP_EDIT],
          null,
        ),
      ).toBe(true);
    });
  });

  describe('hasAllPermissions', () => {
    it('returns true when every permission matches', () => {
      expect(
        service.hasAllPermissions('SECTION', GroupRole.ADMIN, [
          GroupPermission.GROUP_VIEW,
          GroupPermission.GROUP_EDIT,
        ]),
      ).toBe(true);
    });

    it('returns false when at least one permission is missing', () => {
      expect(
        service.hasAllPermissions('SECTION', GroupRole.ADMIN, [
          GroupPermission.GROUP_EDIT,
          GroupPermission.GROUP_ARCHIVE,
        ]),
      ).toBe(false);
    });

    it('returns true for an empty permission list', () => {
      expect(service.hasAllPermissions('SECTION', GroupRole.MEMBER, [])).toBe(
        true,
      );
    });
  });

  describe('getPermissionsForRole (SECTION target)', () => {
    it('returns every GroupPermission for OWNER except HIERARCHY_INVITE', () => {
      // HIERARCHY_INVITE only ever applies to a Group target - only a Group
      // may be the parent side of a hierarchy relationship (a Section can
      // never have children), so it is deliberately absent from
      // SECTION_TARGET_ROLE_PERMISSIONS even for OWNER (see
      // group-role-permissions.map.ts).
      const everyPermissionExceptHierarchyInvite = Object.values(
        GroupPermission,
      ).filter((permission) => permission !== GroupPermission.HIERARCHY_INVITE);
      expect(
        [...service.getPermissionsForRole('SECTION', GroupRole.OWNER)].sort(),
      ).toEqual(everyPermissionExceptHierarchyInvite.sort());
    });
  });

  describe('hasAllPermissionsForRoles (SECTION target)', () => {
    it('grants the full union of every held Role permission set when the membership is ACTIVE', () => {
      expect(
        service.hasAllPermissionsForRoles(
          'SECTION',
          [GroupRole.ADMIN],
          [GroupPermission.GROUP_EDIT, GroupPermission.MEMBERSHIP_ADD],
          SectionMembershipStatus.ACTIVE,
        ),
      ).toBe(true);
    });

    it('unions permissions across several simultaneously held Roles (e.g. MEMBER + ADMIN)', () => {
      expect(
        service.hasAllPermissionsForRoles(
          'SECTION',
          [GroupRole.MEMBER, GroupRole.ADMIN],
          [GroupPermission.GROUP_VIEW, GroupPermission.GROUP_EDIT],
          SectionMembershipStatus.ACTIVE,
        ),
      ).toBe(true);
      expect(
        service.hasAllPermissionsForRoles(
          'SECTION',
          [GroupRole.MEMBER],
          [GroupPermission.GROUP_EDIT],
          SectionMembershipStatus.ACTIVE,
        ),
      ).toBe(false);
    });

    it('restricts to the view-only subset when the membership is READ_ONLY', () => {
      expect(
        service.hasAllPermissionsForRoles(
          'SECTION',
          [GroupRole.OWNER],
          [GroupPermission.GROUP_VIEW],
          SectionMembershipStatus.READ_ONLY,
        ),
      ).toBe(true);
      expect(
        service.hasAllPermissionsForRoles(
          'SECTION',
          [GroupRole.OWNER],
          [GroupPermission.GROUP_EDIT],
          SectionMembershipStatus.READ_ONLY,
        ),
      ).toBe(false);
    });

    it('grants nothing when the membership is INVITED', () => {
      expect(
        service.hasAllPermissionsForRoles(
          'SECTION',
          [GroupRole.OWNER],
          [GroupPermission.GROUP_VIEW],
          SectionMembershipStatus.INVITED,
        ),
      ).toBe(false);
    });

    it('grants nothing when the membership is ARCHIVED - a Role Assignment has no effective access once its membership has ended', () => {
      expect(
        service.hasAllPermissionsForRoles(
          'SECTION',
          [GroupRole.OWNER],
          [GroupPermission.GROUP_VIEW],
          SectionMembershipStatus.ARCHIVED,
        ),
      ).toBe(false);
    });

    it('grants nothing when membership is null for a Section target (no membership found at all)', () => {
      expect(
        service.hasAllPermissionsForRoles(
          'SECTION',
          [GroupRole.OWNER],
          [GroupPermission.GROUP_VIEW],
          null,
        ),
      ).toBe(false);
    });

    it('returns true for an empty roles list only if no permissions are required', () => {
      expect(
        service.hasAllPermissionsForRoles(
          'SECTION',
          [],
          [],
          SectionMembershipStatus.ACTIVE,
        ),
      ).toBe(true);
      expect(
        service.hasAllPermissionsForRoles(
          'SECTION',
          [],
          [GroupPermission.GROUP_VIEW],
          SectionMembershipStatus.ACTIVE,
        ),
      ).toBe(false);
    });
  });
});
