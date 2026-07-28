import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EntityManager } from '@mikro-orm/postgresql';
import { User } from '../users/entities/user.entity';
import { EventCheckInIdentifyResponseDto } from './dto/event-checkin-identify-response.dto';
import { EventAttendeeResponseDto } from './dto/event-attendee-response.dto';
import { EventAccessService } from './event-access.service';
import { EventAttendee } from './entities/event-attendee.entity';
import { EventGuardianAssignment } from './entities/event-guardian-assignment.entity';
import { EventCheckInMethod } from './enums/event-check-in-method.enum';
import { EventStatus } from './enums/event-status.enum';
import { assertEventStatusAllowed } from './event-write-policy';
import { toEventAttendeeResponseDto } from './mappers/event-attendee.mapper';

// One of the most important pieces of this module (see the spec's own
// framing). Every app user carries one stable, non-userId-revealing QR
// code (User.publicCode - see users/dto/user-response.dto.ts); scanning it
// identifies the person, and - if they are an active guardian for any
// children on this Event - those children too (spec: "Jeżeli użytkownik
// jest opiekunem dzieci na tym Evencie, backend zwraca również dzieci
// będące pod jego opieką"). Check-in is allowed while PUBLISHED, and also
// after the Event has lazily auto-FINISHED (see
// event-write-policy.ts#reconcileEventFinished) - a deliberate choice so
// latecomers arriving just after `endsAt` can still be checked in; it is
// never allowed for DRAFT/CANCELLED.
const CHECK_IN_ALLOWED_STATUSES = [
  EventStatus.PUBLISHED,
  EventStatus.FINISHED,
] as const;

@Injectable()
export class EventCheckInService {
  constructor(
    private readonly em: EntityManager,
    private readonly eventAccessService: EventAccessService,
  ) {}

  async identify(
    eventId: string,
    code: string,
  ): Promise<EventCheckInIdentifyResponseDto> {
    const em = this.em;
    const event = await this.eventAccessService.loadOrFail(em, eventId);
    assertEventStatusAllowed(event, [...CHECK_IN_ALLOWED_STATUSES]);

    const scannedUser = await em.findOne(User, { publicCode: code });
    if (!scannedUser) {
      throw new NotFoundException({
        code: 'CHECK_IN_CODE_NOT_FOUND',
        message: 'No user matches this check-in code',
      });
    }

    const selfAttendee = await em.findOne(
      EventAttendee,
      { event: eventId, subjectUser: scannedUser.id },
      { populate: ['registeredBy', 'subjectUser'] },
    );

    const guardianAssignments = await em.find(
      EventGuardianAssignment,
      { event: eventId, guardian: scannedUser.id, revokedAt: null },
      {
        populate: ['attendee', 'attendee.registeredBy', 'attendee.subjectUser'],
      },
    );

    return {
      user: { id: scannedUser.id, displayName: scannedUser.displayName },
      selfAttendee: selfAttendee
        ? toEventAttendeeResponseDto(selfAttendee, null)
        : null,
      childrenUnderGuardianship: guardianAssignments.map((assignment) =>
        toEventAttendeeResponseDto(assignment.attendee, scannedUser.id),
      ),
    };
  }

  async markPresent(
    eventId: string,
    attendeeId: string,
    method: EventCheckInMethod,
    actor: User,
  ): Promise<EventAttendeeResponseDto> {
    return this.em.transactional(async (em) => {
      const event = await this.eventAccessService.loadOrFail(em, eventId);
      assertEventStatusAllowed(event, [...CHECK_IN_ALLOWED_STATUSES]);

      const attendee = await this.loadAttendeeOrFail(em, eventId, attendeeId);
      if (attendee.checkedIn) {
        throw new ConflictException({
          code: 'ATTENDEE_ALREADY_CHECKED_IN',
          message: 'This attendee is already checked in',
        });
      }

      attendee.checkedIn = true;
      attendee.checkedInAt = new Date();
      attendee.checkedInBy = actor;
      attendee.checkInMethod = method;
      await em.flush();

      return toEventAttendeeResponseDto(attendee, null);
    });
  }

  async undoCheckIn(
    eventId: string,
    attendeeId: string,
  ): Promise<EventAttendeeResponseDto> {
    return this.em.transactional(async (em) => {
      const attendee = await this.loadAttendeeOrFail(em, eventId, attendeeId);
      if (!attendee.checkedIn) {
        throw new ConflictException({
          code: 'ATTENDEE_NOT_CHECKED_IN',
          message: 'This attendee is not checked in',
        });
      }

      attendee.checkedIn = false;
      attendee.checkedInAt = null;
      attendee.checkedInBy = null;
      attendee.checkInMethod = null;
      await em.flush();

      return toEventAttendeeResponseDto(attendee, null);
    });
  }

  private async loadAttendeeOrFail(
    em: EntityManager,
    eventId: string,
    attendeeId: string,
  ): Promise<EventAttendee> {
    const attendee = await em.findOne(
      EventAttendee,
      { id: attendeeId, event: eventId },
      { populate: ['registeredBy', 'subjectUser'] },
    );
    if (!attendee) {
      throw new NotFoundException({
        code: 'EVENT_ATTENDEE_NOT_FOUND',
        message: 'Event attendee not found',
      });
    }
    return attendee;
  }
}
