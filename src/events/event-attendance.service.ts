import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EntityManager } from '@mikro-orm/postgresql';
import { AuditLogService } from '../groups/audit-log.service';
import { AuditAction } from '../groups/enums/audit-action.enum';
import { AuditTargetType } from '../groups/enums/audit-target-type.enum';
import { UserCheckInIdentityService } from '../common/identity/user-check-in-identity.service';
import { User } from '../users/entities/user.entity';
import {
  EventAttendanceEntryDto,
  EventAttendanceIdentifyResponseDto,
  EventAttendanceRosterResponseDto,
  EventCheckInResultDto,
} from './dto/event-attendance.dto';
import { EventAccessService } from './event-access.service';
import { eventCommunity } from './event-community.util';
import { EventAttendee } from './entities/event-attendee.entity';
import { EventGuardianAssignment } from './entities/event-guardian-assignment.entity';
import { Event } from './entities/event.entity';
import { EventCheckInMethod } from './enums/event-check-in-method.enum';
import { EventStatus } from './enums/event-status.enum';
import { assertEventStatusAllowed } from './event-write-policy';
import {
  toEventAttendanceEntryDto,
  toEventCheckInResultDto,
} from './mappers/event-attendance.mapper';

// PUBLISHED, or FINISHED (an Event lazily auto-finishes once endsAt passes -
// see reconcileEventFinished - and latecomers must still be checkable after
// that). Never DRAFT, never CANCELLED (module spec §6/§14). Shared by every
// read/write entry point below - identify included, so a caller can never
// identify check-in candidates for an Event they could not actually record
// attendance for (module spec §14: "identyfikacja tylko wtedy, gdy
// organizator może realnie prowadzić attendance").
const ATTENDANCE_ALLOWED_STATUSES = [
  EventStatus.PUBLISHED,
  EventStatus.FINISHED,
] as const;

const CHECK_IN_METHOD_BY_IDENTITY_METHOD: Record<
  'QR' | 'MANUAL',
  EventCheckInMethod
> = {
  QR: EventCheckInMethod.QR,
  MANUAL: EventCheckInMethod.MANUAL,
};

/**
 * Actual, recorded presence at an Event, keyed off the same EventAttendee
 * row EventAttendee.checkedIn already carries - RSVP (declared intent) and
 * attendance (recorded fact) are two different facts on the same row,
 * never conflated. No separate table: `checkedIn`/`checkedInAt`/
 * `checkedInBy`/`checkInMethod` already are exactly the "EventAttendance"
 * shape a dedicated entity would otherwise duplicate.
 *
 * The single, sole check-in system - the legacy publicCode/attendeeId-based
 * controller and service have been removed entirely (finalization cleanup,
 * not a deprecation). Identity is always resolved through
 * UserCheckInIdentityService (numericCode/QR), never publicCode.
 */
@Injectable()
export class EventAttendanceService {
  constructor(
    private readonly em: EntityManager,
    private readonly eventAccessService: EventAccessService,
    private readonly userCheckInIdentityService: UserCheckInIdentityService,
    private readonly auditLogService: AuditLogService,
  ) {}

  async listRoster(eventId: string): Promise<EventAttendanceRosterResponseDto> {
    const em = this.em;
    const event = await this.eventAccessService.loadOrFail(em, eventId);
    const attendees = await em.find(
      EventAttendee,
      { event: eventId },
      { populate: ['subjectUser'], orderBy: { registeredAt: 'asc' } },
    );

    return {
      event: { id: event.id, name: event.name },
      items: attendees.map(toEventAttendanceEntryDto),
    };
  }

  /**
   * POST events/:eventId/attendance/identify - a pure lookup, zero mutation
   * (module spec §6). Resolves `identity` to a User, then reports both
   * their own EventAttendee (if any) and every child attendee they are the
   * *active* guardian for on this Event (see EventGuardianAssignment) -
   * reusing that relationship exactly as legacy identify() did, not a new
   * model (module spec §4). A guardian need not be a participant
   * themselves (module spec §8) - `selfAttendee` and
   * `childrenUnderGuardianship` are independent, never assume one implies
   * the other. Only 404s when neither exists at all.
   */
  async identifyByIdentity(
    eventId: string,
    identity: string,
  ): Promise<EventAttendanceIdentifyResponseDto> {
    const em = this.em;
    await this.assertCheckInAllowed(em, eventId);
    const resolved = await this.userCheckInIdentityService.resolve(
      identity,
      em,
    );

    const selfAttendee = await em.findOne(
      EventAttendee,
      { event: eventId, subjectUser: resolved.user.id },
      { populate: ['subjectUser'] },
    );
    const guardianAssignments = await em.find(
      EventGuardianAssignment,
      { event: eventId, guardian: resolved.user.id, revokedAt: null },
      { populate: ['attendee', 'attendee.subjectUser'] },
    );

    if (!selfAttendee && guardianAssignments.length === 0) {
      throw this.attendeeNotFound();
    }

    return {
      user: { id: resolved.user.id, displayName: resolved.user.displayName },
      selfAttendee: selfAttendee
        ? toEventAttendanceEntryDto(selfAttendee)
        : null,
      childrenUnderGuardianship: guardianAssignments.map((assignment) =>
        toEventAttendanceEntryDto(assignment.attendee),
      ),
    };
  }

  /**
   * PUT events/:eventId/attendance/:userId - the existing user-addressed
   * mutation. Only ever targets that User's own EventAttendee row - never a
   * child (module spec §9/§10: a scan/selection never guesses which
   * dependent showed up).
   */
  async recordAttendance(
    eventId: string,
    userId: string,
    attended: boolean,
    actor: User,
  ): Promise<EventAttendanceEntryDto> {
    return this.em.transactional(async (em) => {
      const event = await this.assertCheckInAllowed(em, eventId);
      const attendee = await this.loadAttendeeByUserOrFail(em, eventId, userId);

      await this.applyAttendance(
        em,
        event,
        attendee,
        attended,
        EventCheckInMethod.MANUAL,
        actor,
      );

      return toEventAttendanceEntryDto(attendee);
    });
  }

  /**
   * PUT events/:eventId/attendance/attendees/:attendeeId - the
   * attendee-addressed variant, added specifically for CHILD_DEPENDENT
   * attendees (module spec §10): they have no User.id to address via the
   * userId-based endpoint above. Works for any attendee (SELF/
   * CHILD_ACCOUNT/CHILD_DEPENDENT) - reuses the exact same write primitive
   * as recordAttendance, never a duplicated mutation path.
   */
  async recordAttendanceByAttendeeId(
    eventId: string,
    attendeeId: string,
    attended: boolean,
    actor: User,
  ): Promise<EventAttendanceEntryDto> {
    return this.em.transactional(async (em) => {
      const event = await this.assertCheckInAllowed(em, eventId);
      const attendee = await this.loadAttendeeByIdOrFail(
        em,
        eventId,
        attendeeId,
      );

      await this.applyAttendance(
        em,
        event,
        attendee,
        attended,
        EventCheckInMethod.MANUAL,
        actor,
      );

      return toEventAttendanceEntryDto(attendee);
    });
  }

  /**
   * Resolves `identity` (numeric code or QR payload - see
   * UserCheckInIdentityService) to a User, requires that User to already
   * be a registered EventAttendee (module spec §7: check-in never creates
   * one), and idempotently marks them present. Only ever the scanned User
   * themselves - never any child they guard (module spec §5/§9): if they
   * have no EventAttendee of their own, this rejects rather than guessing
   * which dependent to check in (use identify + the attendee-based PUT for
   * that). Re-scanning someone already checked in changes nothing and is
   * never an error - see `alreadyCheckedIn` on the response (module spec
   * §8).
   */
  async checkInByIdentity(
    eventId: string,
    identity: string,
    actor: User,
  ): Promise<EventCheckInResultDto> {
    return this.em.transactional(async (em) => {
      const event = await this.assertCheckInAllowed(em, eventId);
      const resolved = await this.userCheckInIdentityService.resolve(
        identity,
        em,
      );
      const attendee = await this.loadAttendeeByUserOrFail(
        em,
        eventId,
        resolved.user.id,
      );

      const alreadyCheckedIn = attendee.checkedIn;
      if (!alreadyCheckedIn) {
        await this.applyAttendance(
          em,
          event,
          attendee,
          true,
          CHECK_IN_METHOD_BY_IDENTITY_METHOD[resolved.method],
          actor,
        );
      }

      return toEventCheckInResultDto(attendee, alreadyCheckedIn);
    });
  }

  /**
   * Loads the Event and enforces both status (module spec §6: never DRAFT/
   * CANCELLED) and timing (never before startsAt - attendance is only
   * meaningful once the Event is actually under way) - shared by every
   * read/write entry point above so the rule can never drift between them.
   */
  private async assertCheckInAllowed(
    em: EntityManager,
    eventId: string,
  ): Promise<Event> {
    const event = await this.eventAccessService.loadOrFail(em, eventId);
    assertEventStatusAllowed(event, ATTENDANCE_ALLOWED_STATUSES);
    if (Date.now() < event.startsAt.getTime()) {
      throw new ConflictException({
        code: 'EVENT_NOT_STARTED',
        message: 'Attendance can only be recorded once the event has started',
      });
    }
    return event;
  }

  private async loadAttendeeByUserOrFail(
    em: EntityManager,
    eventId: string,
    userId: string,
  ): Promise<EventAttendee> {
    const attendee = await em.findOne(
      EventAttendee,
      { event: eventId, subjectUser: userId },
      { populate: ['subjectUser'] },
    );
    if (!attendee) {
      throw this.attendeeNotFound();
    }
    return attendee;
  }

  private async loadAttendeeByIdOrFail(
    em: EntityManager,
    eventId: string,
    attendeeId: string,
  ): Promise<EventAttendee> {
    const attendee = await em.findOne(
      EventAttendee,
      { event: eventId, id: attendeeId },
      { populate: ['subjectUser'] },
    );
    if (!attendee) {
      throw this.attendeeNotFound();
    }
    return attendee;
  }

  /**
   * The single write path for every mutation entry point above. Only
   * audit-logs an actual value change (module spec §15/§17: an idempotent
   * re-scan, or a PUT re-asserting the same value, must never grow the
   * Audit Log) - logged under the Event's own exact Community, targeting
   * the affected User when one exists (mirrors AuditTargetType's own
   * "conceptual target is the person affected" convention - see
   * ADD_ROLE/REMOVE_ROLE/BAN). A CHILD_DEPENDENT attendee has no User at
   * all (module spec §17: "nie wymyślaj fałszywego userId") - the entry is
   * still written (community/action/actor/metadata), just without a
   * resolvable target; `attendeeId` in metadata always identifies exactly
   * which row changed regardless.
   */
  private async applyAttendance(
    em: EntityManager,
    event: Event,
    attendee: EventAttendee,
    attended: boolean,
    method: EventCheckInMethod,
    actor: User,
  ): Promise<void> {
    const changed = attendee.checkedIn !== attended;
    attendee.checkedIn = attended;
    attendee.checkedInAt = new Date();
    attendee.checkedInBy = actor;
    attendee.checkInMethod = method;
    await em.flush();

    // A User-organized Event has no Community (see event-community.util.ts)
    // to file this entry under - AuditLogEntry itself requires exactly one
    // of group/section (see audit-log-entry.entity.ts's own CHECK
    // constraint), and this is exclusively a *Community* audit log (see
    // GET /groups/:groupId/audit-log) with no equivalent surface for a
    // personal Event, so the entry is simply not written in that case; the
    // check-in itself still happens regardless.
    const community = eventCommunity(event);
    if (changed && community) {
      const targetUserId = attendee.subjectUser?.id;
      this.auditLogService.record(em, {
        community,
        action: AuditAction.RECORD_EVENT_ATTENDANCE,
        actor,
        targetType: targetUserId ? AuditTargetType.USER : undefined,
        targetId: targetUserId,
        metadata: { eventId: event.id, attendeeId: attendee.id, attended },
      });
      await em.flush();
    }
  }

  private attendeeNotFound(): NotFoundException {
    return new NotFoundException({
      code: 'EVENT_ATTENDEE_NOT_FOUND',
      message: 'This user is not registered for this event',
    });
  }
}
