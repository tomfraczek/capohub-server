import { EventRole } from '../enums/event-role.enum';
import { EventPermission } from './event-permission.enum';
import { EventPermissionService } from './event-permission.service';

describe('EventPermissionService', () => {
  const service = new EventPermissionService();

  describe('hasPermission', () => {
    it('grants MODERATOR only the operational tier', () => {
      expect(
        service.hasPermission(
          EventRole.MODERATOR,
          EventPermission.EVENT_CHECKIN,
        ),
      ).toBe(true);
      expect(
        service.hasPermission(
          EventRole.MODERATOR,
          EventPermission.EVENT_MANAGE_PARTICIPANTS,
        ),
      ).toBe(true);
      expect(
        service.hasPermission(EventRole.MODERATOR, EventPermission.EVENT_EDIT),
      ).toBe(false);
      expect(
        service.hasPermission(
          EventRole.MODERATOR,
          EventPermission.EVENT_MANAGE_MODERATORS,
        ),
      ).toBe(false);
    });

    it('grants ORGANIZER the full day-to-day tier but not Owner-only permissions', () => {
      expect(
        service.hasPermission(EventRole.ORGANIZER, EventPermission.EVENT_EDIT),
      ).toBe(true);
      expect(
        service.hasPermission(
          EventRole.ORGANIZER,
          EventPermission.EVENT_PUBLISH,
        ),
      ).toBe(true);
      expect(
        service.hasPermission(
          EventRole.ORGANIZER,
          EventPermission.EVENT_MANAGE_MODERATORS,
        ),
      ).toBe(true);
      expect(
        service.hasPermission(
          EventRole.ORGANIZER,
          EventPermission.EVENT_MANAGE_ORGANIZERS,
        ),
      ).toBe(false);
      expect(
        service.hasPermission(
          EventRole.ORGANIZER,
          EventPermission.EVENT_OWNERSHIP_TRANSFER,
        ),
      ).toBe(false);
    });

    it('grants OWNER every permission', () => {
      for (const permission of Object.values(EventPermission)) {
        expect(service.hasPermission(EventRole.OWNER, permission)).toBe(true);
      }
    });
  });

  describe('hasAllPermissionsForRoles', () => {
    it('returns false for an empty role list', () => {
      expect(
        service.hasAllPermissionsForRoles(
          [],
          [EventPermission.EVENT_VIEW_MANAGEMENT],
        ),
      ).toBe(false);
    });

    it('unions permissions across multiple held roles', () => {
      const roles = [EventRole.MODERATOR];
      expect(
        service.hasAllPermissionsForRoles(roles, [EventPermission.EVENT_EDIT]),
      ).toBe(false);

      const combined = [EventRole.MODERATOR, EventRole.ORGANIZER];
      expect(
        service.hasAllPermissionsForRoles(combined, [
          EventPermission.EVENT_CHECKIN,
          EventPermission.EVENT_EDIT,
        ]),
      ).toBe(true);
    });

    it('requires every listed permission to be satisfied', () => {
      expect(
        service.hasAllPermissionsForRoles(
          [EventRole.ORGANIZER],
          [EventPermission.EVENT_EDIT, EventPermission.EVENT_MANAGE_ORGANIZERS],
        ),
      ).toBe(false);
    });
  });
});
