import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EntityManager } from '@mikro-orm/postgresql';
import { User } from '../users/entities/user.entity';
import { AssignGuardianInput } from './dto/assign-guardian.schema';
import { EventGuardianAssignmentResponseDto } from './dto/event-guardian-response.dto';
import { EventAccessService } from './event-access.service';
import { EventAttendee } from './entities/event-attendee.entity';
import { EventGuardianAssignment } from './entities/event-guardian-assignment.entity';
import { EventAttendeeSubjectType } from './enums/event-attendee-subject-type.enum';
import { toEventGuardianAssignmentResponseDto } from './mappers/event-guardian.mapper';

/**
 * "Opiekun wydarzenia" - see event-guardian-assignment.entity.ts for why
 * this is kept separate from the (not-yet-built) global parent -> child
 * relationship. An initial guardian assignment (guardian = the registering
 * parent) is created automatically by EventRsvpService.register; this
 * service is for viewing and reassigning it afterwards - e.g. a different
 * adult is actually bringing/collecting the child on the day.
 *
 * Currently gated as an organizer-only administrative action
 * (EVENT_MANAGE_PARTICIPANTS - see EventGuardiansController): a
 * self-service "let me hand off my child's guardianship to another parent
 * directly" endpoint is a reasonable future addition but is not exposed
 * yet - out of scope for this first cut, flagged in
 * docs/api/events-api.md.
 */
@Injectable()
export class EventGuardiansService {
  constructor(
    private readonly em: EntityManager,
    private readonly eventAccessService: EventAccessService,
  ) {}

  async list(eventId: string): Promise<EventGuardianAssignmentResponseDto[]> {
    const assignments = await this.em.find(
      EventGuardianAssignment,
      { event: eventId, revokedAt: null },
      {
        populate: ['attendee', 'guardian', 'assignedBy'],
        orderBy: { assignedAt: 'asc' },
      },
    );
    return assignments.map(toEventGuardianAssignmentResponseDto);
  }

  async assign(
    eventId: string,
    attendeeId: string,
    input: AssignGuardianInput,
    actor: User,
  ): Promise<EventGuardianAssignmentResponseDto> {
    return this.em.transactional(async (em) => {
      const event = await this.eventAccessService.loadOrFail(em, eventId);

      const attendee = await em.findOne(EventAttendee, {
        id: attendeeId,
        event: eventId,
      });
      if (!attendee) {
        throw new NotFoundException({
          code: 'EVENT_ATTENDEE_NOT_FOUND',
          message: 'Event attendee not found',
        });
      }
      if (attendee.subjectType === EventAttendeeSubjectType.SELF) {
        throw new ConflictException({
          code: 'ATTENDEE_NOT_A_CHILD',
          message:
            'Only a child attendee (not a self-registration) can have a guardian',
        });
      }

      const guardian = await em.findOne(User, { id: input.guardianUserId });
      if (!guardian) {
        throw new NotFoundException({
          code: 'USER_NOT_FOUND',
          message: 'User not found',
        });
      }

      const existing = await em.findOne(EventGuardianAssignment, {
        attendee: attendeeId,
        revokedAt: null,
      });
      if (existing) {
        existing.revokedAt = new Date();
      }

      const assignment = new EventGuardianAssignment();
      assignment.event = event;
      assignment.attendee = attendee;
      assignment.guardian = guardian;
      assignment.assignedBy = actor;
      assignment.assignedAt = new Date();
      await em.persist(assignment).flush();

      return toEventGuardianAssignmentResponseDto(assignment);
    });
  }

  async revoke(eventId: string, attendeeId: string): Promise<void> {
    return this.em.transactional(async (em) => {
      const assignment = await em.findOne(EventGuardianAssignment, {
        event: eventId,
        attendee: attendeeId,
        revokedAt: null,
      });
      if (!assignment) {
        throw new NotFoundException({
          code: 'EVENT_GUARDIAN_ASSIGNMENT_NOT_FOUND',
          message: 'No active guardian assignment for this attendee',
        });
      }
      assignment.revokedAt = new Date();
      await em.flush();
    });
  }
}
