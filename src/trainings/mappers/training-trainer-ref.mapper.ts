import {
  PublicUrlBuilder,
  resolveUserAvatarUrl,
} from '../../storage/image-url.util';
import { User } from '../../users/entities/user.entity';
import { resolveDisplayName } from '../../users/display-name.util';
import { TrainingTrainerRefDto } from '../dto/training-user-ref.dto';

export function toTrainingTrainerRefDto(
  trainer: User,
  urlBuilder: PublicUrlBuilder,
): TrainingTrainerRefDto {
  return {
    id: trainer.id,
    displayName: resolveDisplayName(trainer),
    gender: trainer.gender,
    image: {
      type: trainer.avatarType,
      // Prefers the R2 public URL derived from avatarImageKey over the
      // legacy avatarUrl column once an UPLOAD avatar exists - see
      // storage/image-url.util.ts's resolveUserAvatarUrl.
      url: resolveUserAvatarUrl(trainer, urlBuilder),
      presetAvatarId: trainer.presetAvatarId,
    },
  };
}
