import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EntityManager, FilterQuery } from '@mikro-orm/postgresql';
import { parseQrPayload } from '../common/identity/qr-payload.util';
import {
  assignUniqueNumericCode,
  normalizeNumericCodeInput,
} from '../common/utils/numeric-code';
import { generateUniquePublicCode } from '../common/utils/public-code';
import { Group } from '../groups/entities/group.entity';
import { Section } from '../groups/entities/section.entity';
import { GroupHierarchyService } from '../groups/group-hierarchy.service';
import { GroupPermission } from '../groups/permissions/group-permission.enum';
import { GroupPermissionService } from '../groups/permissions/group-permission.service';
import { RoleAssignmentsService } from '../groups/role-assignments.service';
import { NotificationType } from '../notifications/enums/notification-type.enum';
import { ImageAssetService } from '../storage/image-asset.service';
import { ImageProcessingService } from '../storage/image-processing.service';
import { buildEventCoverImageKey } from '../storage/object-keys.util';
import { R2StorageService } from '../storage/r2-storage.service';
import { User } from '../users/entities/user.entity';
import { CancelEventInput } from './dto/cancel-event.schema';
import { CreateEventInput } from './dto/create-event.schema';
import { EventCapabilitiesDto } from './dto/event-capabilities.dto';
import { EventListQueryInput } from './dto/event-list-query.schema';
import { EventResponseDto } from './dto/event-response.dto';
import { EventPublicAttendeeDto } from './dto/event-public-attendee.dto';
import { UpdateEventInput } from './dto/update-event.schema';
import { EventAccessService } from './event-access.service';
import {
  assignEventCommunity,
  assignEventOrganizerUser,
  eventCommunity,
} from './event-community.util';
import { EventAttendee } from './entities/event-attendee.entity';
import { EventInvitation } from './entities/event-invitation.entity';
import { EventRoleAssignment } from './entities/event-role-assignment.entity';
import { EventScheduleDay } from './entities/event-schedule-day.entity';
import { EventStatusHistory } from './entities/event-status-history.entity';
import {
  Event,
  EVENTS_TYPE_NUMERIC_CODE_UNIQUE_INDEX,
} from './entities/event.entity';
import { EventInvitationStatus } from './enums/event-invitation-status.enum';
import { EventRole } from './enums/event-role.enum';
import { EventRsvpStatus } from './enums/event-rsvp-status.enum';
import { EventStatus } from './enums/event-status.enum';
import { EventType, isEventType } from './enums/event-type.enum';
import { EventWaitlistPolicy } from './enums/event-waitlist-policy.enum';
import { EventVisibility } from './enums/event-visibility.enum';
import { EventParticipantsVisibility } from './enums/event-participants-visibility.enum';
import { EventAttendeeSubjectType } from './enums/event-attendee-subject-type.enum';
import { EventNotificationsService } from './event-notifications.service';
import { EventRolesService } from './event-roles.service';
import { EventRsvpService } from './event-rsvp.service';
import {
  ADMIN_OPERATION_STATUSES,
  ARCHIVABLE_STATUSES,
  assertEventStatusAllowed,
  reconcileEventFinished,
} from './event-write-policy';
import { toEventResponseDto } from './mappers/event.mapper';
import { toEventPublicAttendeeDto } from './mappers/event-attendee.mapper';
import { EventPermission } from './permissions/event-permission.enum';
import { EventPermissionService } from './permissions/event-permission.service';

export interface EventListResult {
  items: EventResponseDto[];
  total: number;
  hasMore: boolean;
}

// Creation, editing, listing/reading, and the DRAFT -> PUBLISHED ->
// CANCELLED/FINISHED lifecycle - see event-write-policy.ts for the status
// transition rules and events-api.md for the full endpoint reference.
@Injectable()
export class EventsService {
  constructor(
    private readonly em: EntityManager,
    private readonly eventAccessService: EventAccessService,
    private readonly eventRolesService: EventRolesService,
    private readonly eventPermissionService: EventPermissionService,
    private readonly roleAssignmentsService: RoleAssignmentsService,
    private readonly groupPermissionService: GroupPermissionService,
    private readonly groupHierarchyService: GroupHierarchyService,
    private readonly eventNotificationsService: EventNotificationsService,
    private readonly eventRsvpService: EventRsvpService,
    private readonly r2StorageService: R2StorageService,
    private readonly imageProcessingService: ImageProcessingService,
    private readonly imageAssetService: ImageAssetService,
  ) {}

  async create(
    communityGroupId: string,
    input: CreateEventInput,
    actor: User,
  ): Promise<EventResponseDto> {
    return this.em.transactional(async (em) => {
      const community = await this.groupHierarchyService.findCommunityById(
        communityGroupId,
        em,
      );
      if (!community) {
        throw this.communityNotFound();
      }

      const event = new Event();
      assignEventCommunity(event, community);
      return this.finalizeCreate(em, event, input, actor);
    });
  }

  /**
   * POST /events (see my-events.controller.ts) - creates an Event whose
   * public organizer identity is the caller themselves, never a Group or
   * a Section (see event-community.util.ts's assignEventOrganizerUser).
   * No Community membership is required - unlike create() above, `actor`
   * need not belong to, let alone administer, any Group/Section; the only
   * gate is being authenticated (module decision: a User may only ever
   * create an Event as *themselves* - there is structurally no
   * `organizerUserId` input field anywhere on CreateEventInput for a
   * caller to substitute another User's identity here).
   */
  async createPersonal(
    input: CreateEventInput,
    actor: User,
  ): Promise<EventResponseDto> {
    return this.em.transactional(async (em) => {
      this.assertVisibilityAllowedForUserOrganizer(input.visibility);

      const event = new Event();
      assignEventOrganizerUser(event, actor);
      return this.finalizeCreate(em, event, input, actor);
    });
  }

  /**
   * Shared create tail for create()/createPersonal() - every field but the
   * organizer identity itself, which the caller has already assigned via
   * assignEventCommunity/assignEventOrganizerUser before calling this.
   */
  private async finalizeCreate(
    em: EntityManager,
    event: Event,
    input: CreateEventInput,
    actor: User,
  ): Promise<EventResponseDto> {
    event.createdBy = actor;
    event.status = EventStatus.DRAFT;
    // type/customTypeLabel are set here, on create, only - see
    // applyCommonFields, which update() also calls but which
    // structurally cannot touch either field (UpdateEventInput has no
    // such keys - see update-event.schema.ts).
    event.type = input.type;
    event.customTypeLabel = input.customTypeLabel;
    this.applyCommonFields(event, input);
    event.publicCode = await generateUniquePublicCode(em);
    await assignUniqueNumericCode(
      em,
      async (trx, code) => {
        event.numericCode = code;
        trx.persist(event);
        await trx.flush();
      },
      EVENTS_TYPE_NUMERIC_CODE_UNIQUE_INDEX,
    );

    const scheduleDays = this.buildScheduleDays(event, input.scheduleDays);
    if (scheduleDays.length > 0) {
      await em.persist(scheduleDays).flush();
    }

    await this.eventRolesService.insertRoleAssignment(
      em,
      event,
      actor,
      EventRole.OWNER,
      actor,
    );
    await this.eventRsvpService.registerOrganizer(em, event, actor);
    await this.recordHistory(em, event, null, EventStatus.DRAFT, actor, null);

    return this.buildResponse(
      em,
      event,
      actor,
      [EventRole.OWNER],
      undefined,
      scheduleDays,
    );
  }

  /**
   * Builds fresh EventScheduleDay entities from a create/update input's own
   * `scheduleDays` - never reads/mutates an existing Collection itself
   * (finalizeCreate has nothing to read yet, update always fully replaces -
   * see its own comment). Cross-field validity (ascending order, within the
   * Event's own startsAt/endsAt) is already guaranteed by
   * refineEventScheduleDays at the schema layer before this ever runs.
   */
  private buildScheduleDays(
    event: Event,
    days: { startsAt: string; endsAt: string }[],
  ): EventScheduleDay[] {
    return days.map((day) => {
      const scheduleDay = new EventScheduleDay();
      scheduleDay.event = event;
      scheduleDay.startsAt = new Date(day.startsAt);
      scheduleDay.endsAt = new Date(day.endsAt);
      return scheduleDay;
    });
  }

  async update(
    eventId: string,
    input: UpdateEventInput,
    actor: User,
  ): Promise<EventResponseDto> {
    return this.em.transactional(async (em) => {
      const event = await this.eventAccessService.loadOrFail(em, eventId, [
        'communityGroup',
        'communitySection',
        'organizerUser',
        'scheduleDays',
      ]);
      assertEventStatusAllowed(event, ADMIN_OPERATION_STATUSES);
      if (event.organizerUser) {
        this.assertVisibilityAllowedForUserOrganizer(input.visibility);
      }

      const timeChanged =
        event.startsAt.getTime() !== new Date(input.startsAt).getTime() ||
        event.endsAt.getTime() !== new Date(input.endsAt).getTime();
      const locationChanged =
        event.locationName !== input.locationName ||
        event.locationAddress !== input.locationAddress;

      // UpdateEventInput structurally has no `type`/`customTypeLabel` keys
      // (see update-event.schema.ts) - there is no line here, or anywhere
      // else in this method, that could reassign event.type even by
      // accident.
      this.applyCommonFields(event, input);
      await em.flush();

      // Delete-then-insert, in two flushes within this one transaction -
      // same ordering hazard/fix as RanksService.update's own identical
      // cordSegments replacement (a resubmitted day's own timestamps could
      // otherwise transiently collide with whatever this Event's current
      // rows already hold, though no unique index actually enforces that
      // here - kept as the same safe convention regardless).
      for (const day of event.scheduleDays.getItems()) {
        em.remove(day);
      }
      await em.flush();
      const scheduleDays = this.buildScheduleDays(event, input.scheduleDays);
      if (scheduleDays.length > 0) {
        await em.persist(scheduleDays).flush();
      }

      // Recipients are this Event's registered attendees only (module spec
      // §24) - never a description-only edit, never check-in/RSVP/
      // attendance (see EventNotificationsService's own comment).
      if (timeChanged) {
        await this.eventNotificationsService.notify(
          em,
          event,
          NotificationType.EVENT_TIME_CHANGED,
        );
      }
      if (locationChanged) {
        await this.eventNotificationsService.notify(
          em,
          event,
          NotificationType.EVENT_LOCATION_CHANGED,
        );
      }

      const roles = await this.eventRolesService.getRolesForUser(
        em,
        eventId,
        actor.id,
      );
      return this.buildResponse(
        em,
        event,
        actor,
        roles,
        undefined,
        scheduleDays,
      );
    });
  }

  async publish(eventId: string, actor: User): Promise<EventResponseDto> {
    return this.em.transactional(async (em) => {
      const event = await this.eventAccessService.loadOrFail(em, eventId, [
        'communityGroup',
        'communitySection',
        'organizerUser',
      ]);
      assertEventStatusAllowed(event, [EventStatus.DRAFT]);
      await this.transitionStatus(
        em,
        event,
        EventStatus.PUBLISHED,
        actor,
        null,
      );

      await this.eventNotificationsService.notifyPublished(em, event);

      const roles = await this.eventRolesService.getRolesForUser(
        em,
        eventId,
        actor.id,
      );
      return this.buildResponse(em, event, actor, roles);
    });
  }

  async cancel(
    eventId: string,
    input: CancelEventInput,
    actor: User,
  ): Promise<EventResponseDto> {
    return this.em.transactional(async (em) => {
      const event = await this.eventAccessService.loadOrFail(em, eventId, [
        'communityGroup',
        'communitySection',
        'organizerUser',
      ]);
      assertEventStatusAllowed(event, ADMIN_OPERATION_STATUSES);
      await this.transitionStatus(
        em,
        event,
        EventStatus.CANCELLED,
        actor,
        input.reason,
      );

      await this.eventNotificationsService.notify(
        em,
        event,
        NotificationType.EVENT_CANCELLED,
      );

      const roles = await this.eventRolesService.getRolesForUser(
        em,
        eventId,
        actor.id,
      );
      return this.buildResponse(em, event, actor, roles);
    });
  }

  async finish(eventId: string, actor: User): Promise<EventResponseDto> {
    return this.em.transactional(async (em) => {
      const event = await this.eventAccessService.loadOrFail(em, eventId, [
        'communityGroup',
        'communitySection',
        'organizerUser',
      ]);
      assertEventStatusAllowed(event, [EventStatus.PUBLISHED]);
      await this.transitionStatus(em, event, EventStatus.FINISHED, actor, null);

      const roles = await this.eventRolesService.getRolesForUser(
        em,
        eventId,
        actor.id,
      );
      return this.buildResponse(em, event, actor, roles);
    });
  }

  /**
   * POST /events/:eventId/archive - the only way an Event ever becomes
   * ARCHIVED (module: "Event lifecycle USER-organized Event + usuwanie
   * konta + archiwizacja Eventu"). Only FINISHED/CANCELLED Events qualify
   * (see ARCHIVABLE_STATUSES) - a live DRAFT/PUBLISHED Event must be
   * cancelled or finished first, same as every other terminal transition.
   * Gated by EventPermission.EVENT_EDIT (see event.controller.ts) - the
   * same trust tier as every other Event-management action, deliberately
   * not a new permission (module decision: "Nie twórz nowego permission,
   * jeśli istniejące lifecycle permissions wystarczą").
   */
  async archive(eventId: string, actor: User): Promise<EventResponseDto> {
    return this.em.transactional(async (em) => {
      const event = await this.eventAccessService.loadOrFail(em, eventId, [
        'communityGroup',
        'communitySection',
        'organizerUser',
      ]);
      assertEventStatusAllowed(event, ARCHIVABLE_STATUSES);
      await this.transitionStatus(em, event, EventStatus.ARCHIVED, actor, null);

      const roles = await this.eventRolesService.getRolesForUser(
        em,
        eventId,
        actor.id,
      );
      return this.buildResponse(em, event, actor, roles);
    });
  }

  /**
   * PUT /events/:eventId/cover-image (module: "R2: upload/replace/delete
   * zdjęć" §16/§20) - gated by EventPermission.EVENT_EDIT, the same
   * permission and lifecycle-status gate as update() above
   * (ADMIN_OPERATION_STATUSES, i.e. DRAFT/PUBLISHED only) - an ARCHIVED (or
   * FINISHED/CANCELLED) Event's cover cannot be changed, the same as every
   * other field (module spec §20: "nie powinien pozwalać na zmianę cover,
   * jeśli canEdit=false" - derived here from the same status check
   * `canEdit` itself is derived from, never re-implemented against a role
   * directly). Clears the legacy coverImageUrl column alongside setting
   * coverImageKey - see event.entity.ts's coverImageUrl comment.
   */
  async uploadCoverImage(
    eventId: string,
    file: Express.Multer.File,
    actor: User,
  ): Promise<EventResponseDto> {
    return this.em.transactional(async (em) => {
      const event = await this.eventAccessService.loadOrFail(em, eventId, [
        'communityGroup',
        'communitySection',
        'organizerUser',
      ]);
      assertEventStatusAllowed(event, ADMIN_OPERATION_STATUSES);

      const processed = await this.imageProcessingService.processCoverImage(
        file.buffer,
      );
      const newKey = buildEventCoverImageKey(event.id);
      await this.imageAssetService.replace({
        processedBuffer: processed,
        newKey,
        oldKey: event.coverImageKey,
        persist: async (key) => {
          event.coverImageKey = key;
          event.coverImageUrl = null;
          await em.flush();
        },
        logContext: { resourceType: 'event-cover-image', resourceId: event.id },
      });

      const roles = await this.eventRolesService.getRolesForUser(
        em,
        eventId,
        actor.id,
      );
      return this.buildResponse(em, event, actor, roles);
    });
  }

  /**
   * DELETE /events/:eventId/cover-image - same gate/status rule as
   * uploadCoverImage above. Idempotent (module spec §42): an Event with no
   * R2 cover simply returns its current state.
   */
  async deleteCoverImage(
    eventId: string,
    actor: User,
  ): Promise<EventResponseDto> {
    return this.em.transactional(async (em) => {
      const event = await this.eventAccessService.loadOrFail(em, eventId, [
        'communityGroup',
        'communitySection',
        'organizerUser',
      ]);
      assertEventStatusAllowed(event, ADMIN_OPERATION_STATUSES);

      await this.imageAssetService.remove({
        oldKey: event.coverImageKey,
        persist: async () => {
          event.coverImageKey = null;
          await em.flush();
        },
        logContext: { resourceType: 'event-cover-image', resourceId: event.id },
      });

      const roles = await this.eventRolesService.getRolesForUser(
        em,
        eventId,
        actor.id,
      );
      return this.buildResponse(em, event, actor, roles);
    });
  }

  /**
   * DELETE /users/me support (see UserService.deleteLocalAccountData) -
   * called with that same method's own transactional `em`, immediately
   * before the User row itself is removed, for every Event where `userId`
   * is organizerUser. A live (DRAFT/PUBLISHED) User-organized Event cannot
   * be left running with no organizer once its account disappears, so each
   * one is force-closed here first: DRAFT/PUBLISHED -> CANCELLED ->
   * ARCHIVED - the exact same two hops an organizer could have taken by
   * hand (see cancel()/archive() above), never a direct DRAFT/PUBLISHED ->
   * ARCHIVED shortcut (see EventStatus's own comment on why). Registered
   * attendees of a PUBLISHED Event are still notified of the cancellation
   * (EventNotificationsService.notify), same as a manual cancel(); a DRAFT
   * Event never has attendees, so that call is a harmless no-op there.
   *
   * FINISHED/CANCELLED Events need no status change at all - they are
   * already terminal - just one more hop straight to ARCHIVED, so the
   * historical Event is consistently closed out rather than left dangling
   * with no organizer in a non-final state. An already-ARCHIVED Event is
   * left untouched.
   *
   * Never touches organizerUser itself - that FK is `deleteRule: 'set
   * null'` (see event.entity.ts) and is cleared automatically the moment
   * the User row is deleted right after this returns. The Event's public
   * organizer identity survives regardless, via organizerType/
   * organizerUserDisplayName (see event-community.util.ts's
   * assignEventOrganizerUser and mappers/event-organizer-ref.mapper.ts).
   *
   * Deliberately independent of EventRole.OWNER: a still-active OWNER on a
   * live Event already blocks account deletion entirely, earlier in
   * deleteLocalAccountData (see EventRolesService.findOwnedActiveEvents) -
   * this method only ever runs for Events that check has already let
   * through, which includes the case where `userId` is organizerUser but
   * has since transferred EventRole.OWNER away to someone else (the public
   * organizer identity has no transfer mechanism - see
   * EventRolesService.transferOwnership - so that Event can still be
   * organizerUser's even though they no longer administer it day-to-day).
   */
  async closeOrganizedEventsForAccountDeletion(
    em: EntityManager,
    userId: string,
    actor: User,
  ): Promise<void> {
    const events = await this.eventRolesService.findOrganizedEvents(em, userId);
    for (const event of events) {
      if (
        event.status === EventStatus.DRAFT ||
        event.status === EventStatus.PUBLISHED
      ) {
        await this.transitionStatus(
          em,
          event,
          EventStatus.CANCELLED,
          actor,
          'Organizer account deleted',
        );
        await this.eventNotificationsService.notify(
          em,
          event,
          NotificationType.EVENT_CANCELLED,
        );
        await this.transitionStatus(
          em,
          event,
          EventStatus.ARCHIVED,
          actor,
          null,
        );
      } else if (
        event.status === EventStatus.FINISHED ||
        event.status === EventStatus.CANCELLED
      ) {
        await this.transitionStatus(
          em,
          event,
          EventStatus.ARCHIVED,
          actor,
          null,
        );
      }
      // ARCHIVED already: nothing to do.
    }
  }

  async getById(eventId: string, viewer: User): Promise<EventResponseDto> {
    const em = this.em;
    const event = await this.eventAccessService.loadOrFail(em, eventId, [
      'communityGroup',
      'communitySection',
      'organizerUser',
      'createdBy',
    ]);
    return this.getVisibleEventResponse(em, event, viewer);
  }

  /**
   * GET events/by-code/:type/:code (see event-lookup.controller.ts) -
   * finds the exact (type, numericCode) Event and applies the identical
   * visibility rule getById does (see getVisibleEventResponse); knowing an
   * Event's public numeric code never bypasses DRAFT/visibility access
   * control (module spec §10).
   */
  async getByTypeAndCode(
    typeInput: string,
    codeInput: string,
    viewer: User,
  ): Promise<EventResponseDto> {
    if (!isEventType(typeInput)) {
      throw new BadRequestException({
        code: 'INVALID_EVENT_TYPE',
        message: `type must be one of ${Object.values(EventType).join(', ')}`,
      });
    }
    const numericCode = normalizeNumericCodeInput(codeInput);
    if (!numericCode) {
      throw new BadRequestException({
        code: 'INVALID_NUMERIC_CODE',
        message: 'code must be exactly 6 digits',
      });
    }

    const em = this.em;
    const event = await this.eventAccessService.loadByTypeAndCodeOrFail(
      em,
      typeInput,
      numericCode,
      ['communityGroup', 'communitySection', 'organizerUser', 'createdBy'],
    );
    return this.getVisibleEventResponse(em, event, viewer);
  }

  /**
   * Resolves a scanned Event QR payload ("capohub:v1:<f|w|r|e>:123456" -
   * see common/identity/qr-payload.util.ts) to its EventResponseDto - the
   * backend half of "scan Event QR -> open Event Details" (module spec
   * §14). A pure read: parses, then delegates straight to getByTypeAndCode
   * so the exact same visibility rule applies as every other Event lookup
   * path - never a check-in, never a mutation. Rejects a User QR payload
   * (or anything unparseable) with a 400, the same "wrong identity type"
   * shape UserCheckInIdentityService uses for the mirror-image case.
   */
  async getByQrPayload(
    payload: string,
    viewer: User,
  ): Promise<EventResponseDto> {
    const parsed = parseQrPayload(payload);
    if (!parsed || parsed.entityType !== 'EVENT') {
      throw new BadRequestException({
        code: 'INVALID_EVENT_QR_PAYLOAD',
        message: 'This is not a valid Event QR payload',
      });
    }
    return this.getByTypeAndCode(parsed.eventType, parsed.numericCode, viewer);
  }

  private async getVisibleEventResponse(
    em: EntityManager,
    event: Event,
    viewer: User,
  ): Promise<EventResponseDto> {
    const roles = await this.resolveRolesOfViewerWhoCanSee(em, event, viewer);
    return this.buildResponse(em, event, viewer, roles);
  }

  /**
   * The viewer's Event roles, once it is confirmed they may see `event` at
   * all - any Event role grants that regardless of visibility; otherwise a
   * DRAFT is never visible and the Event's own visibility rule decides
   * (EventAccessService.isVisibleToViewer). An invisible Event is a 404,
   * never a 403 - its existence is not leaked.
   */
  private async resolveRolesOfViewerWhoCanSee(
    em: EntityManager,
    event: Event,
    viewer: User,
  ): Promise<EventRole[]> {
    const roles = await this.eventRolesService.getRolesForUser(
      em,
      event.id,
      viewer.id,
    );

    if (roles.length === 0) {
      if (event.status === EventStatus.DRAFT) {
        throw this.eventAccessService.eventNotFound();
      }
      const visible = await this.eventAccessService.isVisibleToViewer(
        em,
        event,
        viewer.id,
        viewer.email,
      );
      if (!visible) {
        throw this.eventAccessService.eventNotFound();
      }
    }

    return roles;
  }

  /**
   * GET events/:eventId/attendees - the participant list on Event Details.
   * Same visibility gate as getById first (404 for an Event the viewer
   * cannot see at all), then canViewParticipants (403
   * EVENT_PARTICIPANTS_HIDDEN when the Event is visible but its list is
   * PRIVATE to this viewer). Lists only seat-holding (non-waitlisted,
   * GOING/MAYBE) SELF registrations - see EventPublicAttendeeDto.
   */
  async listPublicAttendees(
    eventId: string,
    viewer: User,
  ): Promise<EventPublicAttendeeDto[]> {
    const em = this.em;
    const event = await this.eventAccessService.loadOrFail(em, eventId);
    const roles = await this.resolveRolesOfViewerWhoCanSee(em, event, viewer);
    const community = eventCommunity(event);
    const oversight = community
      ? await this.resolveCommunityOversight(em, community.id, viewer.id)
      : { viewAll: false, moderate: false };
    if (!this.canViewParticipants(event, roles, oversight)) {
      throw new ForbiddenException({
        code: 'EVENT_PARTICIPANTS_HIDDEN',
        message: "This Event's participant list is not public",
      });
    }

    const attendees = await em.find(
      EventAttendee,
      {
        event: event.id,
        subjectType: EventAttendeeSubjectType.SELF,
        subjectUser: { $ne: null },
        isWaitlisted: false,
        rsvpStatus: { $in: [EventRsvpStatus.GOING, EventRsvpStatus.MAYBE] },
      },
      { populate: ['subjectUser'], orderBy: { registeredAt: 'asc' } },
    );
    return attendees.map((attendee) =>
      toEventPublicAttendeeDto(attendee, this.r2StorageService),
    );
  }

  // Staff (any Event role) and the Community's event overseers always see
  // the participant list; everyone else only when the organizer made it
  // PUBLIC (see event-participants-visibility.enum.ts).
  private canViewParticipants(
    event: Event,
    roles: EventRole[],
    oversight: { viewAll: boolean; moderate: boolean },
  ): boolean {
    return (
      event.participantsVisibility === EventParticipantsVisibility.PUBLIC ||
      roles.length > 0 ||
      oversight.viewAll ||
      oversight.moderate
    );
  }

  async list(
    communityGroupId: string,
    viewer: User,
    query: EventListQueryInput,
  ): Promise<EventListResult> {
    const em = this.em;
    const community = await this.groupHierarchyService.findCommunityById(
      communityGroupId,
      em,
    );
    if (!community) {
      throw this.communityNotFound();
    }

    const isMember = await this.eventAccessService.isActiveCommunityMember(
      em,
      community.id,
      viewer.id,
    );
    const oversight = await this.resolveCommunityOversight(
      em,
      communityGroupId,
      viewer.id,
    );

    const eventInCommunity = {
      $or: [
        { communityGroup: communityGroupId },
        { communitySection: communityGroupId },
      ],
    };
    // Sequential, not Promise.all - concurrent queries on the same
    // EntityManager/connection race each other at the driver level.
    const roleAssignments = await em.find(
      EventRoleAssignment,
      { user: viewer.id, event: eventInCommunity },
      { populate: ['event'] },
    );
    const invitations = await em.find(EventInvitation, {
      event: eventInCommunity,
      status: {
        $in: [EventInvitationStatus.PENDING, EventInvitationStatus.ACCEPTED],
      },
      $or: [{ invitedUser: viewer.id }, { invitedEmail: viewer.email }],
    });
    const roleEventIds = [
      ...new Set(roleAssignments.map((assignment) => assignment.event.id)),
    ];
    const invitedEventIds = [
      ...new Set(invitations.map((invitation) => invitation.event.id)),
    ];
    const rolesByEvent = new Map<string, EventRole[]>();
    for (const assignment of roleAssignments) {
      const list = rolesByEvent.get(assignment.event.id) ?? [];
      list.push(assignment.role);
      rolesByEvent.set(assignment.event.id, list);
    }

    const where: FilterQuery<Event> = {
      $or: [
        { communityGroup: communityGroupId },
        { communitySection: communityGroupId },
      ],
    };
    if (query.status) where.status = query.status;
    if (query.type) where.type = query.type;
    if (query.from) where.endsAt = { $gte: new Date(query.from) };
    if (query.to) where.startsAt = { $lte: new Date(query.to) };

    if (!oversight.viewAll) {
      const visibilityOr: FilterQuery<Event>[] = [
        { visibility: EventVisibility.PUBLIC },
      ];
      if (isMember) {
        visibilityOr.push({ visibility: EventVisibility.COMMUNITY_MEMBERS });
      }
      if (invitedEventIds.length > 0) {
        visibilityOr.push({ id: { $in: invitedEventIds } });
      }

      where.$and = [
        {
          $or: [
            {
              $and: [
                { status: { $ne: EventStatus.DRAFT } },
                { $or: visibilityOr },
              ],
            },
            ...(roleEventIds.length > 0 ? [{ id: { $in: roleEventIds } }] : []),
          ],
        },
      ];
    }

    const [events, total] = await em.findAndCount(Event, where, {
      populate: ['communityGroup', 'communitySection', 'organizerUser'],
      orderBy: { startsAt: 'asc' },
      limit: query.limit,
      offset: query.offset,
    });

    for (const event of events) {
      await reconcileEventFinished(em, event);
    }

    // Sequential, not Promise.all(events.map(...)) - each buildResponse
    // issues several queries against the same EntityManager/connection;
    // running them concurrently races at the driver level.
    const items = [];
    for (const event of events) {
      items.push(
        await this.buildResponse(
          em,
          event,
          viewer,
          rolesByEvent.get(event.id) ?? [],
          oversight,
        ),
      );
    }

    return {
      items,
      total,
      hasMore: query.offset + items.length < total,
    };
  }

  /**
   * Every Event visible to `viewer` across every Community they have any
   * relationship to - the "global events" feed (see events-api.md § Global
   * Events). Reuses exactly the same visibility rule as list() (PUBLIC to
   * anyone, COMMUNITY_MEMBERS to active members of that specific
   * Community, INVITE_ONLY to invitees, any Event role always included),
   * just without pre-selecting one `communityGroupId` - so the frontend
   * never has to fetch every Group/Section it belongs to and merge one
   * per-community request itself.
   *
   * Deliberately excludes the Community-level oversight override
   * (GroupPermission.EVENT_VIEW_ALL/EVENT_MODERATE) that list() resolves
   * for a single community: that is an Admin/Owner "browse every Draft
   * under the community I manage" tool, already served by
   * GET /groups/:groupId/events - not part of "the events relevant to me"
   * that this feed answers.
   */
  async listForViewer(
    viewer: User,
    query: EventListQueryInput,
  ): Promise<EventListResult> {
    const em = this.em;
    const { visibilityAnd, rolesByEvent } = await this.resolveViewerVisibility(
      em,
      viewer,
    );

    const where: FilterQuery<Event> = { $and: visibilityAnd };
    if (query.status) where.status = query.status;
    if (query.type) where.type = query.type;
    if (query.from) where.endsAt = { $gte: new Date(query.from) };
    if (query.to) where.startsAt = { $lte: new Date(query.to) };

    const [events, total] = await em.findAndCount(Event, where, {
      populate: ['communityGroup', 'communitySection', 'organizerUser'],
      orderBy: { startsAt: 'asc' },
      limit: query.limit,
      offset: query.offset,
    });

    for (const event of events) {
      await reconcileEventFinished(em, event);
    }

    // Sequential, not Promise.all(events.map(...)) - see list()'s identical
    // comment above.
    const items = [];
    for (const event of events) {
      items.push(
        await this.buildResponse(
          em,
          event,
          viewer,
          rolesByEvent.get(event.id) ?? [],
        ),
      );
    }

    return {
      items,
      total,
      hasMore: query.offset + items.length < total,
    };
  }

  /**
   * The single soonest upcoming Event (any type) visible to `viewer` from
   * `from` onward - backs Home.nearestEvent (see HomeService).
   * Home.nearestTraining is a wholly separate fact, resolved by
   * TrainingsService.findNearestForViewer instead (Training is a distinct
   * entity, never an Event - see the trainings module).
   *
   * Explicitly excludes ARCHIVED - a historical/retired Event must never
   * surface as "your next upcoming event", even in the edge case of a
   * CANCELLED-then-ARCHIVED Event whose `endsAt` still happens to be in the
   * future (module: "ARCHIVED nie może pojawiać się jako aktywny/
   * nadchodzący Event"). No such exclusion is needed for list()/
   * listForViewer(), which are general-purpose/history-inclusive listings,
   * not an "upcoming" concept.
   */
  async findNearestEvent(
    viewer: User,
    from: string,
  ): Promise<EventResponseDto | null> {
    const em = this.em;
    const { visibilityAnd, rolesByEvent } = await this.resolveViewerVisibility(
      em,
      viewer,
    );
    const endsAtFrom = { $gte: new Date(from) };

    const [anyEvents] = await em.findAndCount(
      Event,
      {
        $and: visibilityAnd,
        endsAt: endsAtFrom,
        status: { $ne: EventStatus.ARCHIVED },
      },
      {
        populate: ['communityGroup', 'communitySection', 'organizerUser'],
        orderBy: { startsAt: 'asc' },
        limit: 1,
      },
    );

    for (const event of anyEvents) {
      await reconcileEventFinished(em, event);
    }

    return anyEvents[0]
      ? this.buildResponse(
          em,
          anyEvents[0],
          viewer,
          rolesByEvent.get(anyEvents[0].id) ?? [],
        )
      : null;
  }

  /**
   * Every Event `viewer` is actually associated with as a participant -
   * they are the registered subject of an EventAttendee row (SELF, or a
   * CHILD_ACCOUNT row where `viewer` is that child's own account - never a
   * CHILD_DEPENDENT registered by someone else, which has no `subjectUser`
   * to match) or they hold an EventRoleAssignment (Organizer/Moderator/
   * Owner - they are running it, so it belongs on their calendar too).
   * Deliberately NOT the same rule as listForViewer/resolveViewerVisibility
   * above: those return every Event a Community membership merely lets
   * `viewer` *see* (including PUBLIC Events they never registered for) -
   * this is CalendarService's "my calendar" source, which must be narrower
   * (see the Calendar module spec § User Calendar). No status filter -
   * CANCELLED Events stay visible here too, same reasoning as Trainings.
   */
  async findForViewerInRange(
    viewer: User,
    from: string,
    to: string,
  ): Promise<EventResponseDto[]> {
    const em = this.em;
    // Sequential, not Promise.all - concurrent queries on the same
    // EntityManager/connection race each other at the driver level.
    const attendeeRows = await em.find(
      EventAttendee,
      { subjectUser: viewer.id },
      { fields: ['event'] },
    );
    const roleRows = await em.find(
      EventRoleAssignment,
      { user: viewer.id },
      { populate: ['event'] },
    );
    const eventIds = [
      ...new Set([
        ...attendeeRows.map((row) => row.event.id),
        ...roleRows.map((row) => row.event.id),
      ]),
    ];
    if (eventIds.length === 0) {
      return [];
    }

    const rolesByEvent = new Map<string, EventRole[]>();
    for (const assignment of roleRows) {
      const list = rolesByEvent.get(assignment.event.id) ?? [];
      list.push(assignment.role);
      rolesByEvent.set(assignment.event.id, list);
    }

    const events = await em.find(
      Event,
      {
        id: { $in: eventIds },
        // Intersecting-range, not startsAt-only - see list()'s identical
        // from/to shape; an Event spanning the range boundary must still
        // be included.
        startsAt: { $lt: new Date(to) },
        endsAt: { $gt: new Date(from) },
      },
      {
        populate: ['communityGroup', 'communitySection', 'organizerUser'],
        orderBy: { startsAt: 'asc' },
      },
    );

    for (const event of events) {
      await reconcileEventFinished(em, event);
    }

    // Sequential, not Promise.all(events.map(...)) - see list()'s identical
    // comment above.
    const items: EventResponseDto[] = [];
    for (const event of events) {
      items.push(
        await this.buildResponse(
          em,
          event,
          viewer,
          rolesByEvent.get(event.id) ?? [],
        ),
      );
    }
    return items;
  }

  /**
   * Resolves everything listForViewer/findNearestEventAndTraining need to
   * decide which Events `viewer` may see, independent of any `type`/`from`/
   * `to` query filter: their shared Groups (own Root Group plus every
   * descendant - ADR-002, unlimited hierarchy depth), Event Role
   * Assignments (always visible regardless of Community membership), and
   * pending/accepted Event Invitations. Returns a ready-to-spread `$and`
   * fragment (same rule both callers used to build inline: PUBLIC to
   * anyone, COMMUNITY_MEMBERS to members of one of `viewer`'s Communities,
   * invited-only Events to their invitee, any Event Role always included -
   * DRAFT excluded unless a Role applies) plus the viewer's own roles per
   * Event for buildResponse's `viewerRoles`/`capabilities`.
   */
  private async resolveViewerVisibility(
    em: EntityManager,
    viewer: User,
  ): Promise<{
    visibilityAnd: FilterQuery<Event>[];
    rolesByEvent: Map<string, EventRole[]>;
  }> {
    // "My communities" - every Group where I hold an active RoleAssignment
    // (Group's only participants are role holders) and every Section where
    // I have an active membership. No inheritance: unlike the old
    // root-Membership model, this never expands to a whole organization
    // tree just because I belong to one Section or Group somewhere in it -
    // see RoleAssignmentsService.getCommunityIdsWithAnyRole.
    const participation =
      await this.roleAssignmentsService.getCommunityIdsWithAnyRole(viewer.id);
    const myCommunityGroupIds = new Set<string>();
    const myCommunitySectionIds = new Set<string>();
    if (participation.length > 0) {
      // Sequential, not Promise.all - concurrent queries on the same
      // EntityManager/connection race each other at the driver level.
      const groups = await em.find(
        Group,
        { id: { $in: participation } },
        { fields: ['id'] },
      );
      const sections = await em.find(
        Section,
        { id: { $in: participation } },
        { fields: ['id'] },
      );
      for (const group of groups) {
        myCommunityGroupIds.add(group.id);
      }
      for (const section of sections) {
        myCommunitySectionIds.add(section.id);
      }
    }

    // Sequential, not Promise.all - concurrent queries on the same
    // EntityManager/connection race each other at the driver level.
    const roleAssignments = await em.find(
      EventRoleAssignment,
      { user: viewer.id },
      { populate: ['event'] },
    );
    const invitations = await em.find(EventInvitation, {
      status: {
        $in: [EventInvitationStatus.PENDING, EventInvitationStatus.ACCEPTED],
      },
      $or: [{ invitedUser: viewer.id }, { invitedEmail: viewer.email }],
    });
    const roleEventIds = [
      ...new Set(roleAssignments.map((assignment) => assignment.event.id)),
    ];
    const invitedEventIds = [
      ...new Set(invitations.map((invitation) => invitation.event.id)),
    ];
    const rolesByEvent = new Map<string, EventRole[]>();
    for (const assignment of roleAssignments) {
      const list = rolesByEvent.get(assignment.event.id) ?? [];
      list.push(assignment.role);
      rolesByEvent.set(assignment.event.id, list);
    }

    const visibilityOr: FilterQuery<Event>[] = [
      { visibility: EventVisibility.PUBLIC },
    ];
    if (myCommunityGroupIds.size > 0) {
      visibilityOr.push({
        visibility: EventVisibility.COMMUNITY_MEMBERS,
        communityGroup: { $in: [...myCommunityGroupIds] },
      });
    }
    if (myCommunitySectionIds.size > 0) {
      visibilityOr.push({
        visibility: EventVisibility.COMMUNITY_MEMBERS,
        communitySection: { $in: [...myCommunitySectionIds] },
      });
    }
    if (invitedEventIds.length > 0) {
      visibilityOr.push({ id: { $in: invitedEventIds } });
    }

    const visibilityAnd: FilterQuery<Event>[] = [
      {
        $or: [
          {
            $and: [
              { status: { $ne: EventStatus.DRAFT } },
              { $or: visibilityOr },
            ],
          },
          ...(roleEventIds.length > 0 ? [{ id: { $in: roleEventIds } }] : []),
        ],
      },
    ];

    return { visibilityAnd, rolesByEvent };
  }

  // Every field but `type`/`customTypeLabel` - shared by create() and
  // update(). Takes UpdateEventInput (the narrower shape, lacking
  // type/customTypeLabel) so update() can never pass those fields through
  // even by accident; create() still satisfies this, since CreateEventInput
  // is a structural superset of UpdateEventInput.
  private applyCommonFields(event: Event, input: UpdateEventInput): void {
    event.name = input.name;
    event.description = input.description;
    event.coverImageUrl = input.coverImageUrl;
    event.startsAt = new Date(input.startsAt);
    event.endsAt = new Date(input.endsAt);
    event.locationName = input.locationName;
    event.locationAddress = input.locationAddress;
    event.visibility = input.visibility;
    event.capacity = input.capacity;
    event.waitlistPolicy =
      input.capacity == null ? EventWaitlistPolicy.NONE : input.waitlistPolicy;
    event.participantsVisibility = input.participantsVisibility;
  }

  private async transitionStatus(
    em: EntityManager,
    event: Event,
    toStatus: EventStatus,
    actor: User,
    reason: string | null,
  ): Promise<void> {
    await this.recordHistory(em, event, event.status, toStatus, actor, reason);
    event.status = toStatus;
    await em.flush();
  }

  private async recordHistory(
    em: EntityManager,
    event: Event,
    fromStatus: EventStatus | null,
    toStatus: EventStatus,
    actor: User | null,
    reason: string | null,
  ): Promise<void> {
    const history = new EventStatusHistory();
    history.event = event;
    history.fromStatus = fromStatus;
    history.toStatus = toStatus;
    history.actor = actor;
    history.reason = reason;
    await em.persist(history).flush();
  }

  /**
   * Community-level oversight the viewer holds over `communityGroupId`
   * (GroupPermission.EVENT_VIEW_ALL / EVENT_MODERATE) - independent of any
   * Event role. See group-permission.enum.ts for why these exist at all.
   */
  private async resolveCommunityOversight(
    em: EntityManager,
    communityGroupId: string,
    viewerId: string,
  ): Promise<{ viewAll: boolean; moderate: boolean }> {
    const authorization =
      await this.roleAssignmentsService.resolveAuthorization(
        communityGroupId,
        viewerId,
        em,
      );
    if (!authorization) {
      return { viewAll: false, moderate: false };
    }
    const roles = authorization.roleAssignments.map((a) => a.role);
    const targetKind =
      authorization.community instanceof Group ? 'GROUP' : 'SECTION';
    const has = (permission: GroupPermission): boolean =>
      this.groupPermissionService.hasAllPermissionsForRoles(
        targetKind,
        roles,
        [permission],
        authorization.membership?.status ?? null,
      );
    return {
      viewAll: has(GroupPermission.EVENT_VIEW_ALL),
      moderate: has(GroupPermission.EVENT_MODERATE),
    };
  }

  private async buildResponse(
    em: EntityManager,
    event: Event,
    viewer: User,
    viewerRoles: EventRole[],
    precomputedOversight?: { viewAll: boolean; moderate: boolean },
    // Only finalizeCreate/update pass this - they build a fresh in-memory
    // scheduleDays list that has no DB-backed Collection to lazily load
    // from yet (same reasoning as RanksService/toRankResponseDto's own
    // segments param). Every other caller (get/list/publish/cancel/finish/
    // transfer-ownership/…) omits it, so `event.scheduleDays.loadItems`
    // below lazily populates from the DB on demand - it resolves instantly
    // if already populated, so this is never a redundant query for a
    // caller whose `loadOrFail` already included 'scheduleDays'.
    precomputedScheduleDays?: EventScheduleDay[],
  ): Promise<EventResponseDto> {
    // Sequential, not Promise.all - concurrent queries on the same
    // EntityManager/connection race each other at the driver level.
    const attendeeCounts = await this.countAttendees(em, event);
    const scheduleDays =
      precomputedScheduleDays ??
      (await event.scheduleDays.loadItems({ orderBy: { startsAt: 'asc' } }));
    const community = eventCommunity(event);
    // A User-organized Event has no Community to hold oversight over (see
    // event-community.util.ts) - EVENT_VIEW_ALL/EVENT_MODERATE simply never
    // apply, exactly as if the caller held neither permission.
    const oversight =
      precomputedOversight ??
      (community
        ? await this.resolveCommunityOversight(em, community.id, viewer.id)
        : { viewAll: false, moderate: false });
    const canRegister = await this.eventAccessService.canViewerRegister(
      em,
      event,
      viewer.id,
      viewer.email,
    );

    const capabilities = this.buildCapabilities(
      viewerRoles,
      oversight.moderate,
      canRegister,
      event.status,
      this.canViewParticipants(event, viewerRoles, oversight),
    );

    return toEventResponseDto(
      event,
      {
        viewerRoles,
        capabilities,
        seatsTaken: attendeeCounts.seatsTaken,
        seatsAvailable:
          event.capacity == null
            ? null
            : Math.max(event.capacity - attendeeCounts.seatsTaken, 0),
        waitlistCount: attendeeCounts.waitlistCount,
        scheduleDays,
      },
      this.r2StorageService,
    );
  }

  private async countAttendees(
    em: EntityManager,
    event: Event,
  ): Promise<{ seatsTaken: number; waitlistCount: number }> {
    // Sequential, not Promise.all - concurrent queries on the same
    // EntityManager/connection race each other at the driver level.
    const seatsTaken = await em.count(EventAttendee, {
      event: event.id,
      isWaitlisted: false,
      rsvpStatus: { $in: [EventRsvpStatus.GOING, EventRsvpStatus.MAYBE] },
    });
    const waitlistCount = await em.count(EventAttendee, {
      event: event.id,
      isWaitlisted: true,
    });
    return { seatsTaken, waitlistCount };
  }

  private buildCapabilities(
    roles: EventRole[],
    hasModerateOverride: boolean,
    canRegister: boolean,
    status: EventStatus,
    canViewParticipants: boolean,
  ): EventCapabilitiesDto {
    const has = (permission: EventPermission): boolean =>
      this.eventPermissionService.hasAllPermissionsForRoles(roles, [
        permission,
      ]);
    // ARCHIVED is a closed, historical state (see event-status.enum.ts) -
    // every write/management capability is unconditionally false here,
    // regardless of role, mirroring how assertEventStatusAllowed already
    // rejects every one of these actions at the service layer once
    // archived; this makes the response DTO honest about it up front
    // instead of the frontend having to special-case ARCHIVED itself
    // (module: "Dla ARCHIVED... ARCHIVED nie jest aktywnym Eventem
    // operacyjnym"). canViewManagement/canRegister are deliberately NOT
    // included here: management reads (history, roles list) stay available
    // for a historical Event, and canRegister is already false for any
    // non-PUBLISHED status via canViewerRegister.
    const isArchived = status === EventStatus.ARCHIVED;

    return {
      canViewManagement: roles.length > 0,
      canEdit: !isArchived && has(EventPermission.EVENT_EDIT),
      canPublish: !isArchived && has(EventPermission.EVENT_PUBLISH),
      canCancel:
        !isArchived &&
        (has(EventPermission.EVENT_CANCEL) || hasModerateOverride),
      canFinish: !isArchived && has(EventPermission.EVENT_FINISH),
      canManageOrganizers:
        !isArchived && has(EventPermission.EVENT_MANAGE_ORGANIZERS),
      canManageModerators:
        !isArchived && has(EventPermission.EVENT_MANAGE_MODERATORS),
      canTransferOwnership:
        !isArchived && has(EventPermission.EVENT_OWNERSHIP_TRANSFER),
      canManageInvitations:
        !isArchived && has(EventPermission.EVENT_MANAGE_INVITATIONS),
      canManageParticipants:
        !isArchived && has(EventPermission.EVENT_MANAGE_PARTICIPANTS),
      canCheckIn: !isArchived && has(EventPermission.EVENT_CHECKIN),
      canRegister,
      canViewParticipants,
    };
  }

  private communityNotFound(): NotFoundException {
    return new NotFoundException({
      code: 'GROUP_NOT_FOUND',
      message: 'Group not found',
    });
  }

  /**
   * COMMUNITY_MEMBERS visibility is only meaningful relative to an Event's
   * own Community (see EventAccessService.isVisibleToViewer) - a
   * User-organized Event has none (module decision: "Nie twórz sztucznego
   * community dla Usera"), so it structurally cannot use that value.
   * Called from createPersonal() unconditionally, and from update()
   * whenever the Event being edited is User-organized - PUBLIC and
   * INVITE_ONLY remain fully available either way (neither depends on
   * Community membership).
   */
  private assertVisibilityAllowedForUserOrganizer(
    visibility: EventVisibility,
  ): void {
    if (visibility === EventVisibility.COMMUNITY_MEMBERS) {
      throw new BadRequestException({
        code: 'EVENT_VISIBILITY_REQUIRES_COMMUNITY',
        message:
          'COMMUNITY_MEMBERS visibility requires a Group or Section organizer - a User-organized Event has no Community to check membership against',
      });
    }
  }
}
