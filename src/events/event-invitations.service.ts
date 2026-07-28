import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EntityManager } from '@mikro-orm/postgresql';
import { isUniqueViolationOn } from '../common/utils/db-errors';
import { User } from '../users/entities/user.entity';
import { CreateEventInvitationInput } from './dto/create-event-invitation.schema';
import { EventInvitationResponseDto } from './dto/event-invitation-response.dto';
import { EventAccessService } from './event-access.service';
import {
  EVENT_INVITATIONS_PENDING_EMAIL_IDX,
  EVENT_INVITATIONS_PENDING_USER_IDX,
  EventInvitation,
} from './entities/event-invitation.entity';
import { EventInvitationStatus } from './enums/event-invitation-status.enum';
import { toEventInvitationResponseDto } from './mappers/event-invitation.mapper';

@Injectable()
export class EventInvitationsService {
  constructor(
    private readonly em: EntityManager,
    private readonly eventAccessService: EventAccessService,
  ) {}

  async create(
    eventId: string,
    input: CreateEventInvitationInput,
    actor: User,
  ): Promise<EventInvitationResponseDto> {
    return this.em.transactional(async (em) => {
      const event = await this.eventAccessService.loadOrFail(em, eventId);

      let invitedUser: User | null = null;
      if (input.userId) {
        invitedUser = await em.findOne(User, { id: input.userId });
        if (!invitedUser) {
          throw new NotFoundException({
            code: 'USER_NOT_FOUND',
            message: 'User not found',
          });
        }
      }

      const invitation = new EventInvitation();
      invitation.event = event;
      invitation.invitedBy = actor;
      invitation.invitedUser = invitedUser;
      invitation.invitedEmail = invitedUser ? null : (input.email ?? null);

      try {
        await em.persist(invitation).flush();
      } catch (error) {
        if (
          isUniqueViolationOn(error, EVENT_INVITATIONS_PENDING_USER_IDX) ||
          isUniqueViolationOn(error, EVENT_INVITATIONS_PENDING_EMAIL_IDX)
        ) {
          throw new ConflictException({
            code: 'EVENT_INVITATION_ALREADY_PENDING',
            message:
              'This person already has a pending invitation to this event',
          });
        }
        throw error;
      }

      return toEventInvitationResponseDto(invitation);
    });
  }

  async list(eventId: string): Promise<EventInvitationResponseDto[]> {
    const invitations = await this.em.find(
      EventInvitation,
      { event: eventId },
      {
        populate: ['invitedBy', 'invitedUser'],
        orderBy: { createdAt: 'desc' },
      },
    );
    return invitations.map(toEventInvitationResponseDto);
  }

  async cancel(eventId: string, invitationId: string): Promise<void> {
    return this.em.transactional(async (em) => {
      const invitation = await this.loadOrFail(em, eventId, invitationId);
      if (invitation.status !== EventInvitationStatus.PENDING) {
        throw new ConflictException({
          code: 'EVENT_INVITATION_NOT_PENDING',
          message: 'Only a pending invitation can be cancelled',
        });
      }
      invitation.status = EventInvitationStatus.CANCELLED;
      invitation.respondedAt = new Date();
      await em.flush();
    });
  }

  /**
   * Self-service: the invited person declining without ever registering
   * (see event-invitation.entity.ts - accepting has no separate endpoint,
   * it happens implicitly on registration).
   */
  async decline(
    eventId: string,
    invitationId: string,
    actor: User,
  ): Promise<void> {
    return this.em.transactional(async (em) => {
      const invitation = await this.loadOrFail(em, eventId, invitationId);

      const isInvitee =
        invitation.invitedUser?.id === actor.id ||
        (invitation.invitedEmail !== null &&
          invitation.invitedEmail === actor.email);
      if (!isInvitee) {
        throw new ForbiddenException({
          code: 'NOT_YOUR_INVITATION',
          message: 'This invitation was not sent to you',
        });
      }
      if (invitation.status !== EventInvitationStatus.PENDING) {
        throw new ConflictException({
          code: 'EVENT_INVITATION_NOT_PENDING',
          message: 'Only a pending invitation can be declined',
        });
      }

      invitation.status = EventInvitationStatus.DECLINED;
      invitation.respondedAt = new Date();
      await em.flush();
    });
  }

  private async loadOrFail(
    em: EntityManager,
    eventId: string,
    invitationId: string,
  ): Promise<EventInvitation> {
    const invitation = await em.findOne(
      EventInvitation,
      { id: invitationId, event: eventId },
      { populate: ['invitedBy', 'invitedUser'] },
    );
    if (!invitation) {
      throw new NotFoundException({
        code: 'EVENT_INVITATION_NOT_FOUND',
        message: 'Event invitation not found',
      });
    }
    return invitation;
  }
}
