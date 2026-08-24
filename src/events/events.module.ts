import { Module } from '@nestjs/common';
import { UserCheckInIdentityService } from '../common/identity/user-check-in-identity.service';
import { GroupsModule } from '../groups/groups.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { StorageModule } from '../storage/storage.module';
import { EventAccessService } from './event-access.service';
import { EventAttendanceController } from './event-attendance.controller';
import { EventAttendanceService } from './event-attendance.service';
import { EventGuardiansController } from './event-guardians.controller';
import { EventGuardiansService } from './event-guardians.service';
import { EventHistoryService } from './event-history.service';
import { EventInvitationsController } from './event-invitations.controller';
import { EventInvitationsService } from './event-invitations.service';
import { EventNotificationsService } from './event-notifications.service';
import { EventRolesController } from './event-roles.controller';
import { EventRolesService } from './event-roles.service';
import { EventRsvpController } from './event-rsvp.controller';
import { EventRsvpService } from './event-rsvp.service';
import { EventController } from './event.controller';
import { EventLookupController } from './event-lookup.controller';
import { EventsController } from './events.controller';
import { EventsService } from './events.service';
import { EventPermissionsGuard } from './guards/event-permissions.guard';
import { CHILDREN_DIRECTORY_PORT } from './integration/children-directory.port';
import { NullChildrenDirectoryService } from './integration/null-children-directory.service';
import { MyEventsController } from './my-events.controller';
import { EventPermissionService } from './permissions/event-permission.service';

// Entities are driven through the plain EntityManager (auto-discovered
// globally, see mikro-orm-options.factory.ts), so no forFeature() is
// needed - same convention as GroupsModule. Imports GroupsModule to reuse
// its Community-level authorization machinery (RoleAssignmentsService,
// GroupPermissionService, GroupHierarchyService, GroupPermissionsGuard) -
// never the reverse (ADR-024: Group Domain independence; Events is
// explicitly out of scope for it).
@Module({
  // StorageModule is imported for the Event cover-image upload/delete
  // endpoints (see EventsService.uploadCoverImage/deleteCoverImage) and
  // for resolving coverImageUrl/organizer image URLs in every
  // EventResponseDto (see mappers/event.mapper.ts,
  // mappers/event-organizer-ref.mapper.ts).
  imports: [GroupsModule, NotificationsModule, StorageModule],
  controllers: [
    EventsController,
    MyEventsController,
    // Declared before EventController - EventController's bare @Get() at
    // `events/:eventId` is a 2-segment route, the same shape as this
    // controller's `events/by-qr` (unlike `events/by-code/:type/:code`,
    // which is 3 segments and never collides regardless of order). Nest
    // matches route-registration order for equally-shaped routes, so
    // EventLookupController must be registered first or `by-qr` gets
    // swallowed by `:eventId` (failing ParseUUIDPipe with a misleading
    // "uuid is expected" 400 instead of ever reaching getByQrPayload).
    EventLookupController,
    EventController,
    EventRolesController,
    EventInvitationsController,
    EventRsvpController,
    EventGuardiansController,
    EventAttendanceController,
  ],
  providers: [
    EventAccessService,
    EventsService,
    EventRolesService,
    EventRsvpService,
    EventInvitationsService,
    EventGuardiansService,
    EventAttendanceService,
    EventNotificationsService,
    // Stateless (only needs EntityManager) - provided directly here rather
    // than via a shared module, since UsersModule already imports
    // EventsModule (see users.module.ts) and importing UsersModule back
    // here would be circular (see user-check-in-identity.service.ts's own
    // comment). TrainingsModule provides its own instance the same way.
    UserCheckInIdentityService,
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
  // UserService.deleteLocalAccountData). EventsService is exported for
  // HomeModule, which reuses listForViewer as-is (same viewer-scoped
  // visibility rules as GET /events) rather than re-querying Events itself.
  // EventAccessService is exported for GraduationModule (FormalRankService's
  // rank<->Event evidence link, see loadAndValidateEventLink) and for
  // CareerTimelineModule (EVENT entry visibility, see
  // career-timeline-aggregation.service.ts) - both reuse
  // isVisibleToViewer/loadOrFail rather than re-deriving Event visibility.
  exports: [EventRolesService, EventsService, EventAccessService],
})
export class EventsModule {}
