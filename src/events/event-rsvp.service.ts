import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EntityManager, LockMode } from '@mikro-orm/postgresql';
import { User } from '../users/entities/user.entity';
import { CHILDREN_DIRECTORY_PORT } from './integration/children-directory.port';
import type { ChildrenDirectoryPort } from './integration/children-directory.port';
import { EventAccessService } from './event-access.service';
import { EventAttendeeResponseDto } from './dto/event-attendee-response.dto';
import { RegisterForEventInput } from './dto/register-for-event.schema';
import { UpdateRsvpInput } from './dto/update-rsvp.schema';
import { EventAttendee } from './entities/event-attendee.entity';
import { EventGuardianAssignment } from './entities/event-guardian-assignment.entity';
import { EventInvitationStatus } from './enums/event-invitation-status.enum';
import { EventAttendeeSubjectType } from './enums/event-attendee-subject-type.enum';
import { EventRsvpStatus } from './enums/event-rsvp-status.enum';
import { EventStatus } from './enums/event-status.enum';
import { EventVisibility } from './enums/event-visibility.enum';
import { EventWaitlistPolicy } from './enums/event-waitlist-policy.enum';
import { Event } from './entities/event.entity';
import {
  ADMIN_OPERATION_STATUSES,
  assertEventStatusAllowed,
} from './event-write-policy';
import { toEventAttendeeResponseDto } from './mappers/event-attendee.mapper';

/**
 * Self-service registration (spec: "Uczestnicy zapisują się sami lub są
 * zapraszani... Nie istnieje ręczne dodawanie uczestników przez
 * organizatora") - a single call registers the caller and/or any number of
 * their children at once, and owns the capacity/waitlist bookkeeping. RSVP
 * changes on an already-registered attendee (any number of times) go
 * through updateRsvp.
 */
@Injectable()
export class EventRsvpService {
  constructor(
    private readonly em: EntityManager,
    private readonly eventAccessService: EventAccessService,
    @Inject(CHILDREN_DIRECTORY_PORT)
    private readonly childrenDirectoryPort: ChildrenDirectoryPort,
  ) {}

  /**
   * Auto-registers the Event's own creator as a GOING attendee at creation
   * time (module: "jeśli organizuję jakiś event to automatycznie powinienem
   * zostać dodany do listy uczestników") - called from
   * EventsService.finalizeCreate, still inside the same transaction that
   * creates the Event itself. Deliberately bypasses register()'s own
   * PUBLISHED-status/eligibility gate above (a brand new Event is still
   * DRAFT at this point, and canViewerRegister requires PUBLISHED - see
   * EventAccessService.canViewerRegister) since the creator's own
   * eligibility is never in question here: they are always its OWNER.
   * Reuses upsertAttendee/assignSeatOrWaitlist so this row is
   * indistinguishable from a self-service registration once the Event is
   * published - always seated, never waitlisted (it is structurally the
   * very first attendee, and every Event's capacity - when set - must be
   * at least 1, see create-event.schema.ts).
   */
  async registerOrganizer(
    em: EntityManager,
    event: Event,
    actor: User,
  ): Promise<void> {
    await this.upsertAttendee(
      em,
      event,
      actor,
      EventAttendeeSubjectType.SELF,
      actor,
      null,
      EventRsvpStatus.GOING,
    );
  }

  async register(
    eventId: string,
    input: RegisterForEventInput,
    actor: User,
  ): Promise<EventAttendeeResponseDto[]> {
    return this.em.transactional(async (em) => {
      const event = await this.eventAccessService.loadOrFail(em, eventId, [
        'communityGroup',
        'communitySection',
      ]);
      assertEventStatusAllowed(event, [EventStatus.PUBLISHED]);

      const eligible = await this.eventAccessService.canViewerRegister(
        em,
        event,
        actor.id,
        actor.email,
      );
      if (!eligible) {
        throw new ForbiddenException({
          code: 'EVENT_REGISTRATION_NOT_ALLOWED',
          message: 'You are not allowed to register for this event',
        });
      }

      const attendees: EventAttendee[] = [];

      if (input.attendSelf) {
        attendees.push(
          await this.upsertAttendee(
            em,
            event,
            actor,
            EventAttendeeSubjectType.SELF,
            actor,
            null,
            input.selfRsvpStatus,
          ),
        );
      }

      for (const child of input.children) {
        let attendee: EventAttendee;
        if (child.subjectType === 'CHILD_ACCOUNT') {
          const allowed =
            await this.childrenDirectoryPort.canRegisterChildAccount(
              actor.id,
              child.childUserId,
            );
          if (!allowed) {
            throw new ConflictException({
              code: 'CHILDREN_DIRECTORY_NOT_AVAILABLE',
              message:
                'Registering a child with their own account is not available yet - see children-directory.port.ts',
            });
          }
          const childUser = em.getReference(User, child.childUserId);
          attendee = await this.upsertAttendee(
            em,
            event,
            actor,
            EventAttendeeSubjectType.CHILD_ACCOUNT,
            childUser,
            null,
            EventRsvpStatus.GOING,
          );
        } else {
          attendee = await this.upsertAttendee(
            em,
            event,
            actor,
            EventAttendeeSubjectType.CHILD_DEPENDENT,
            null,
            child.displayName,
            EventRsvpStatus.GOING,
          );
        }
        await this.ensureGuardianAssignment(em, event, attendee, actor);
        attendees.push(attendee);
      }

      if (event.visibility === EventVisibility.INVITE_ONLY) {
        const invitation = await this.eventAccessService.findActiveInvitation(
          em,
          eventId,
          actor.id,
          actor.email,
        );
        if (invitation && invitation.status === EventInvitationStatus.PENDING) {
          invitation.status = EventInvitationStatus.ACCEPTED;
          invitation.respondedAt = new Date();
          await em.flush();
        }
      }

      return this.toResponseDtos(em, attendees);
    });
  }

  async updateRsvp(
    eventId: string,
    attendeeId: string,
    input: UpdateRsvpInput,
    actor: User,
  ): Promise<EventAttendeeResponseDto> {
    return this.em.transactional(async (em) => {
      const event = await this.eventAccessService.loadOrFail(em, eventId, [
        'communityGroup',
        'communitySection',
      ]);
      assertEventStatusAllowed(event, [EventStatus.PUBLISHED]);

      const attendee = await em.findOne(
        EventAttendee,
        { id: attendeeId, event: eventId },
        { populate: ['registeredBy', 'subjectUser'] },
      );
      if (!attendee) {
        throw this.attendeeNotFound();
      }
      if (attendee.registeredBy.id !== actor.id) {
        throw new ForbiddenException({
          code: 'NOT_YOUR_REGISTRATION',
          message: 'You may only change RSVP for registrations you made',
        });
      }

      await this.applyRsvpChange(em, event, attendee, input.rsvpStatus);
      return (await this.toResponseDtos(em, [attendee]))[0];
    });
  }

  async listMyRegistrations(
    eventId: string,
    actor: User,
  ): Promise<EventAttendeeResponseDto[]> {
    const attendees = await this.em.find(
      EventAttendee,
      { event: eventId, registeredBy: actor.id },
      {
        populate: ['registeredBy', 'subjectUser'],
        orderBy: { registeredAt: 'asc' },
      },
    );
    return this.toResponseDtos(this.em, attendees);
  }

  async listParticipants(eventId: string): Promise<EventAttendeeResponseDto[]> {
    const attendees = await this.em.find(
      EventAttendee,
      { event: eventId },
      {
        populate: ['registeredBy', 'subjectUser'],
        orderBy: { registeredAt: 'asc' },
      },
    );
    return this.toResponseDtos(this.em, attendees);
  }

  /**
   * Manual waitlist promotion (only valid when waitlistPolicy is MANUAL -
   * spec: "Ręczna: organizator sam wybiera osoby z listy rezerwowej").
   */
  async promoteFromWaitlist(
    eventId: string,
    attendeeId: string,
  ): Promise<EventAttendeeResponseDto> {
    return this.em.transactional(async (em) => {
      const event = await this.eventAccessService.loadOrFail(em, eventId, [
        'communityGroup',
        'communitySection',
      ]);
      assertEventStatusAllowed(event, ADMIN_OPERATION_STATUSES);
      if (event.waitlistPolicy !== EventWaitlistPolicy.MANUAL) {
        throw new ConflictException({
          code: 'EVENT_NOT_MANUAL_WAITLIST',
          message: 'This event does not use a manual waitlist',
        });
      }

      // See assignSeatOrWaitlist for why this lock is required - a manual
      // promotion is a capacity-relevant mutation just like a fresh
      // registration, and must be serialized against any concurrent one
      // for this same Event.
      await em.lock(event, LockMode.PESSIMISTIC_WRITE);

      const attendee = await em.findOne(
        EventAttendee,
        { id: attendeeId, event: eventId },
        { populate: ['registeredBy', 'subjectUser'] },
      );
      if (!attendee) {
        throw this.attendeeNotFound();
      }
      if (!attendee.isWaitlisted) {
        throw new ConflictException({
          code: 'ATTENDEE_NOT_WAITLISTED',
          message: 'This attendee is not on the waitlist',
        });
      }

      attendee.isWaitlisted = false;
      attendee.promotedAt = new Date();
      await em.flush();

      return (await this.toResponseDtos(em, [attendee]))[0];
    });
  }

  /**
   * Creates a new EventAttendee row, or - if `subjectUser` is already
   * registered for this Event - updates its RSVP in place (re-registering
   * is idempotent, never a duplicate row - spec: RSVP can change any
   * number of times). CHILD_DEPENDENT rows are never deduplicated (no
   * stable identity to match on - see event-attendee.entity.ts), so
   * repeated calls with the same displayName intentionally create separate
   * rows.
   */
  private async upsertAttendee(
    em: EntityManager,
    event: Event,
    registeredBy: User,
    subjectType: EventAttendeeSubjectType,
    subjectUser: User | null,
    dependentDisplayName: string | null,
    rsvpStatus: EventRsvpStatus,
  ): Promise<EventAttendee> {
    const existing = subjectUser
      ? await em.findOne(EventAttendee, {
          event: event.id,
          subjectUser: subjectUser.id,
        })
      : null;

    if (existing) {
      return this.applyRsvpChange(em, event, existing, rsvpStatus);
    }

    const attendee = new EventAttendee();
    attendee.event = event;
    attendee.registeredBy = registeredBy;
    attendee.subjectType = subjectType;
    attendee.subjectUser = subjectUser;
    attendee.dependentDisplayName = dependentDisplayName;
    attendee.rsvpStatus = rsvpStatus;
    attendee.registeredAt = new Date();
    await this.assignSeatOrWaitlist(em, event, attendee);
    await em.persist(attendee).flush();
    return attendee;
  }

  /**
   * Applies a new RSVP decision to an existing row, keeping capacity/
   * waitlist bookkeeping consistent: moving to NOT_GOING always frees any
   * seat/waitlist slot held (triggering AUTOMATIC promotion of the next
   * waitlisted attendee, if configured); moving from NOT_GOING back to
   * GOING/MAYBE re-attempts seat/waitlist assignment as if registering
   * fresh; switching between GOING and MAYBE while already seated or
   * already waitlisted changes nothing about seat/waitlist state.
   */
  private async applyRsvpChange(
    em: EntityManager,
    event: Event,
    attendee: EventAttendee,
    newRsvpStatus: EventRsvpStatus,
  ): Promise<EventAttendee> {
    const previousStatus = attendee.rsvpStatus;
    const wasWaitlisted = attendee.isWaitlisted;
    attendee.rsvpStatus = newRsvpStatus;

    if (newRsvpStatus === EventRsvpStatus.NOT_GOING) {
      const wasHoldingSeat =
        !wasWaitlisted &&
        (previousStatus === EventRsvpStatus.GOING ||
          previousStatus === EventRsvpStatus.MAYBE);
      attendee.isWaitlisted = false;
      await em.flush();
      if (wasHoldingSeat) {
        await this.tryPromoteNextFromWaitlist(em, event);
      }
      return attendee;
    }

    if (wasWaitlisted) {
      await em.flush();
      return attendee;
    }

    if (previousStatus === EventRsvpStatus.NOT_GOING) {
      await this.assignSeatOrWaitlist(em, event, attendee);
    }
    await em.flush();
    return attendee;
  }

  /**
   * Decides whether `attendee` claims a seat or is waitlisted - the one
   * place capacity is actually enforced, so it is also the one place a
   * concurrency guard is required. Without it, two concurrent
   * registrations for the same Event could each run the `count` below
   * before either has committed, both see e.g. "9 of 10 seats taken", and
   * both grant a seat - overshooting `capacity`.
   *
   * `em.lock(event, LockMode.PESSIMISTIC_WRITE)` issues a `SELECT ... FOR
   * UPDATE` against this Event's own row (same primitive
   * UserService.deleteLocalAccountData already relies on for an analogous
   * invariant - see its own comment on PESSIMISTIC_WRITE). Postgres blocks
   * any other transaction trying to acquire the same lock until this one
   * commits or rolls back, so the count below is always accurate relative
   * to every other concurrent registration/RSVP-change/manual-promotion
   * for this exact Event - concurrent requests for *different* Events are
   * completely unaffected, since each Event's row is locked independently.
   */
  private async assignSeatOrWaitlist(
    em: EntityManager,
    event: Event,
    attendee: EventAttendee,
  ): Promise<void> {
    if (event.capacity == null) {
      attendee.isWaitlisted = false;
      return;
    }

    await em.lock(event, LockMode.PESSIMISTIC_WRITE);

    const seatsTaken = await em.count(EventAttendee, {
      event: event.id,
      isWaitlisted: false,
      rsvpStatus: { $in: [EventRsvpStatus.GOING, EventRsvpStatus.MAYBE] },
    });

    if (seatsTaken < event.capacity) {
      attendee.isWaitlisted = false;
      return;
    }

    if (event.waitlistPolicy === EventWaitlistPolicy.NONE) {
      throw new ConflictException({
        code: 'EVENT_FULL',
        message: 'This event has no more available seats',
      });
    }

    attendee.isWaitlisted = true;
    attendee.waitlistedAt = new Date();
  }

  private async tryPromoteNextFromWaitlist(
    em: EntityManager,
    event: Event,
  ): Promise<void> {
    if (event.waitlistPolicy !== EventWaitlistPolicy.AUTOMATIC) {
      return;
    }

    // Same reasoning as assignSeatOrWaitlist - promoting the next waitlisted
    // attendee is itself a capacity-relevant mutation and must be
    // serialized against a concurrent fresh registration/promotion for
    // this same Event.
    await em.lock(event, LockMode.PESSIMISTIC_WRITE);

    const next = await em.findOne(
      EventAttendee,
      { event: event.id, isWaitlisted: true },
      { orderBy: { waitlistedAt: 'asc' } },
    );
    if (!next) {
      return;
    }
    next.isWaitlisted = false;
    next.promotedAt = new Date();
    await em.flush();
  }

  private async ensureGuardianAssignment(
    em: EntityManager,
    event: Event,
    attendee: EventAttendee,
    registeredBy: User,
  ): Promise<void> {
    const existing = await em.findOne(EventGuardianAssignment, {
      attendee: attendee.id,
      revokedAt: null,
    });
    if (existing) {
      return;
    }
    const assignment = new EventGuardianAssignment();
    assignment.event = event;
    assignment.attendee = attendee;
    assignment.guardian = registeredBy;
    assignment.assignedBy = registeredBy;
    assignment.assignedAt = new Date();
    await em.persist(assignment).flush();
  }

  private async toResponseDtos(
    em: EntityManager,
    attendees: EventAttendee[],
  ): Promise<EventAttendeeResponseDto[]> {
    if (attendees.length === 0) {
      return [];
    }
    const guardianAssignments = await em.find(EventGuardianAssignment, {
      attendee: { $in: attendees.map((a) => a.id) },
      revokedAt: null,
    });
    const guardianByAttendee = new Map(
      guardianAssignments.map((assignment) => [
        assignment.attendee.id,
        assignment.guardian.id,
      ]),
    );
    return attendees.map((attendee) =>
      toEventAttendeeResponseDto(
        attendee,
        guardianByAttendee.get(attendee.id) ?? null,
      ),
    );
  }

  private attendeeNotFound(): NotFoundException {
    return new NotFoundException({
      code: 'EVENT_ATTENDEE_NOT_FOUND',
      message: 'Event attendee not found',
    });
  }
}
