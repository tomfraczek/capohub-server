import { ForbiddenException, Injectable } from '@nestjs/common';
import { EntityManager } from '@mikro-orm/postgresql';
import { isUniqueViolationOn } from '../common/utils/db-errors';
import { User } from '../users/entities/user.entity';
import { UpdateTrainingRsvpInput } from './dto/update-training-rsvp.schema';
import { TrainingRsvpResponseDto } from './dto/training-rsvp-response.dto';
import { Training } from './entities/training.entity';
import {
  TRAINING_RSVPS_UNIQUE_INDEX,
  TrainingRsvp,
} from './entities/training-rsvp.entity';
import { TrainingAccessService } from './training-access.service';
import {
  assertTrainingNotCancelled,
  assertTrainingNotStarted,
} from './training-write-policy';
import { toTrainingRsvpResponseDto } from './mappers/training-rsvp.mapper';

const TRAINING_POPULATE = ['section', 'trainer', 'series'] as const;

// A user's own declared intent to attend - see the module spec §6. Every
// method here only ever acts on the calling user's own row; there is no
// "set RSVP for someone else" path anywhere in this service.
@Injectable()
export class TrainingRsvpService {
  constructor(
    private readonly em: EntityManager,
    private readonly trainingAccessService: TrainingAccessService,
  ) {}

  async setRsvp(
    trainingId: string,
    input: UpdateTrainingRsvpInput,
    actor: User,
  ): Promise<TrainingRsvpResponseDto> {
    return this.em.transactional(async (em) => {
      const training = await this.loadTraining(em, trainingId);
      assertTrainingNotCancelled(training);
      assertTrainingNotStarted(training);

      const canRsvp = await this.trainingAccessService.canRsvp(
        em,
        training,
        actor.id,
      );
      if (!canRsvp) {
        throw new ForbiddenException({
          code: 'TRAINING_RSVP_NOT_ALLOWED',
          message: 'You are not allowed to RSVP to this training',
        });
      }

      let rsvp = await em.findOne(TrainingRsvp, {
        training: trainingId,
        user: actor.id,
      });
      const isNew = !rsvp;
      if (!rsvp) {
        rsvp = new TrainingRsvp();
        rsvp.training = training;
        rsvp.user = actor;
      }
      rsvp.status = input.status;
      rsvp.respondedAt = new Date();

      try {
        await em.persist(rsvp).flush();
      } catch (error) {
        // Race backstop: two concurrent setRsvp calls for the same
        // (training, user) both passed the findOne check above before
        // either flushed - same precedent as
        // SectionMembershipsService.addMember. The partial unique index on
        // training_rsvps (see the entity) is the database-level backstop;
        // on conflict, fall back to updating the row the other request
        // just inserted instead of surfacing a 500.
        if (isNew && isUniqueViolationOn(error, TRAINING_RSVPS_UNIQUE_INDEX)) {
          const existing = await em.findOneOrFail(TrainingRsvp, {
            training: trainingId,
            user: actor.id,
          });
          existing.status = input.status;
          existing.respondedAt = new Date();
          await em.flush();
          return toTrainingRsvpResponseDto(existing);
        }
        throw error;
      }

      return toTrainingRsvpResponseDto(rsvp);
    });
  }

  async deleteRsvp(trainingId: string, actor: User): Promise<void> {
    return this.em.transactional(async (em) => {
      const training = await this.loadTraining(em, trainingId);
      assertTrainingNotCancelled(training);
      assertTrainingNotStarted(training);

      const rsvp = await em.findOne(TrainingRsvp, {
        training: trainingId,
        user: actor.id,
      });
      if (rsvp) {
        await em.remove(rsvp).flush();
      }
    });
  }

  async listRsvps(
    trainingId: string,
    viewer: User,
  ): Promise<TrainingRsvpResponseDto[]> {
    const em = this.em;
    const training = await this.loadTraining(em, trainingId);
    const visible = await this.trainingAccessService.isVisibleToViewer(
      em,
      training,
      viewer.id,
    );
    if (!visible) {
      throw this.trainingAccessService.trainingNotFound();
    }

    const rsvps = await em.find(
      TrainingRsvp,
      { training: trainingId },
      { populate: ['user'], orderBy: { respondedAt: 'asc' } },
    );
    return rsvps.map(toTrainingRsvpResponseDto);
  }

  private async loadTraining(
    em: EntityManager,
    trainingId: string,
  ): Promise<Training> {
    const training = await em.findOne(
      Training,
      { id: trainingId },
      { populate: [...TRAINING_POPULATE] },
    );
    if (!training) {
      throw this.trainingAccessService.trainingNotFound();
    }
    return training;
  }
}
