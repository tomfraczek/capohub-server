import { ConflictException } from '@nestjs/common';
import { Training } from './entities/training.entity';
import { TrainingStatus } from './enums/training-status.enum';

// A Training's own lifecycle status is a business object concept, not a
// Group concept (mirrors event-write-policy.ts's identical split from
// group-write-policy.ts). Every Training write action calls this directly
// against the Training's *current* status.
const STATUS_CONFLICTS: Readonly<
  Partial<Record<TrainingStatus, { code: string; message: string }>>
> = {
  [TrainingStatus.CANCELLED]: {
    code: 'TRAINING_CANCELLED',
    message: 'This training has been cancelled',
  },
};

export function assertTrainingNotCancelled(
  training: Pick<Training, 'status'>,
): void {
  if (training.status === TrainingStatus.CANCELLED) {
    throw new ConflictException(
      STATUS_CONFLICTS[TrainingStatus.CANCELLED] ?? {
        code: 'TRAINING_STATUS_NOT_ALLOWED',
        message:
          "This action is not available in the training's current status",
      },
    );
  }
}

export function isTrainingStarted(
  training: Pick<Training, 'startsAt'>,
  now: Date = new Date(),
): boolean {
  return training.startsAt.getTime() <= now.getTime();
}

// Shared by RSVP changes (frozen once the training starts - module spec §6)
// and attendance recording's lower bound is the mirror image of this (see
// TrainingAttendanceService - attendance may only be recorded *from*
// startsAt, i.e. once this would return true).
export function assertTrainingNotStarted(
  training: Pick<Training, 'startsAt'>,
  now: Date = new Date(),
): void {
  if (isTrainingStarted(training, now)) {
    throw new ConflictException({
      code: 'TRAINING_ALREADY_STARTED',
      message: 'This training has already started',
    });
  }
}
