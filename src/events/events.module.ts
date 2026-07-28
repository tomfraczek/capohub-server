import { Module } from '@nestjs/common';
import { GroupsModule } from '../groups/groups.module';
import { EventAccessService } from './event-access.service';
import { EventCheckInController } from './event-checkin.controller';
import { EventCheckInService } from './event-checkin.service';
import { EventGuardiansController } from './event-guardians.controller';
import { EventGuardiansService } from './event-guardians.service';
import { EventHistoryService } from './event-history.service';
import { EventInvitationsController } from './event-invitations.controller';
import { EventInvitationsService } from './event-invitations.service';
import { EventRolesController } from './event-roles.controller';
import { EventRolesService } from './event-roles.service';
import { EventRsvpController } from './event-rsvp.controller';
import { EventRsvpService } from './event-rsvp.service';
import { EventController } from './event.controller';
import { EventsController } from './events.controller';
import { EventsService } from './events.service';
import { EventPermissionsGuard } from './guards/event-permissions.guard';
import { CHILDREN_DIRECTORY_PORT } from './integration/children-directory.port';
import { NullChildrenDirectoryService } from './integration/null-children-directory.service';
import { EventPermissionService } from './permissions/event-permission.service';

// Entities are driven through the plain EntityManager (auto-discovered
// globally, see mikro-orm-options.factory.ts), so no forFeature() is
// needed - same convention as GroupsModule. Imports GroupsModule to reuse
// its Community-level authorization machinery (RoleAssignmentsService,
// GroupPermissionService, GroupHierarchyService, GroupPermissionsGuard) -
// never the reverse (ADR-024: Organization Domain independence; Events is
// explicitly out of scope for it).
@Module({
  imports: [GroupsModule],
  controllers: [
    EventsController,
    EventController,
    EventRolesController,
    EventInvitationsController,
    EventRsvpController,
    EventGuardiansController,
    EventCheckInController,
  ],
  providers: [
    EventAccessService,
    EventsService,
    EventRolesService,
    EventRsvpService,
    EventInvitationsService,
    EventGuardiansService,
    EventCheckInService,
    EventHistoryService,
    EventPermissionService,
    EventPermissionsGuard,
    // Placeholder binding until a real Children/Family module exists - see
    // children-directory.port.ts.
    {
      provide: CHILDREN_DIRECTORY_PORT,
      useClass: NullChildrenDirectoryService,
    },
  ],
  // EventRolesService is exported for UsersModule - DELETE /users/me must
  // not hard-delete a User who solely owns a live (DRAFT/PUBLISHED) Event
  // (see EventRolesService.findOwnedActiveEvents and
  // UserService.deleteLocalAccountData).
  exports: [EventRolesService],
})
export class EventsModule {}
