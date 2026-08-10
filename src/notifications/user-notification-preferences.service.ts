import { Injectable } from '@nestjs/common';
import { EntityManager } from '@mikro-orm/postgresql';
import { User } from '../users/entities/user.entity';
import { UpdateUserNotificationPreferencesInput } from './dto/update-user-notification-preferences.schema';
import { UserNotificationPreferencesResponseDto } from './dto/user-notification-preferences-response.dto';
import { UserNotificationPreferences } from './entities/user-notification-preferences.entity';

// Scoped entirely to the caller's own row - no userId param anywhere (see
// UserNotificationPreferencesController). A missing row means "every
// default applies" - same lazy-creation convention as
// CommunityNotificationSettingsService.
@Injectable()
export class UserNotificationPreferencesService {
  constructor(private readonly em: EntityManager) {}

  async get(user: User): Promise<UserNotificationPreferencesResponseDto> {
    const preferences = await this.em.findOne(UserNotificationPreferences, {
      user: user.id,
    });
    return toResponseDto(preferences);
  }

  async update(
    user: User,
    input: UpdateUserNotificationPreferencesInput,
  ): Promise<UserNotificationPreferencesResponseDto> {
    return this.em.transactional(async (em) => {
      let preferences = await em.findOne(UserNotificationPreferences, {
        user: user.id,
      });
      if (!preferences) {
        preferences = new UserNotificationPreferences();
        preferences.user = user;
        em.persist(preferences);
      }

      Object.assign(preferences, input);
      await em.flush();

      return toResponseDto(preferences);
    });
  }
}

function toResponseDto(
  preferences: UserNotificationPreferences | null,
): UserNotificationPreferencesResponseDto {
  return {
    pushEnabled: preferences?.pushEnabled ?? true,
    pushCommunity: preferences?.pushCommunity ?? true,
    pushTraining: preferences?.pushTraining ?? true,
    pushEvent: preferences?.pushEvent ?? true,
    pushMembership: preferences?.pushMembership ?? true,
    pushGraduation: preferences?.pushGraduation ?? true,
    pushPayment: preferences?.pushPayment ?? true,
    trainingReminder24h: preferences?.trainingReminder24h ?? true,
    trainingReminder2h: preferences?.trainingReminder2h ?? true,
    eventReminder24h: preferences?.eventReminder24h ?? true,
    eventReminder2h: preferences?.eventReminder2h ?? true,
  };
}
