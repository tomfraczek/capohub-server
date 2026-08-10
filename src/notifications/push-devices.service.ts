import { Injectable, NotFoundException } from '@nestjs/common';
import { EntityManager } from '@mikro-orm/postgresql';
import { User } from '../users/entities/user.entity';
import { PushDeviceResponseDto } from './dto/push-device-response.dto';
import { RegisterPushDeviceInput } from './dto/register-push-device.schema';
import { PushDevice } from './entities/push-device.entity';

// Self-service only (module spec section 14/40) - every method takes the
// caller's own User, never a userId param; unregister additionally scopes
// its lookup to `user: user.id` so one user can never deactivate another's
// device (IDOR-safe, 404 either way).
@Injectable()
export class PushDevicesService {
  constructor(private readonly em: EntityManager) {}

  /**
   * Idempotent register: if this exact Expo token is already known, the
   * existing row is updated in place (including `user`, so a token that
   * moved to a different account - reinstall, different user signed in on
   * the same physical device - is reassigned rather than duplicated; the
   * previous owner can no longer receive push through this device, since
   * the row is no longer theirs - module spec section 14). Otherwise a
   * fresh row is created.
   */
  async register(
    user: User,
    input: RegisterPushDeviceInput,
  ): Promise<PushDeviceResponseDto> {
    return this.em.transactional(async (em) => {
      let device = await em.findOne(PushDevice, {
        expoPushToken: input.token,
      });
      if (!device) {
        device = new PushDevice();
        device.expoPushToken = input.token;
        em.persist(device);
      }
      device.user = user;
      device.platform = input.platform;
      device.isActive = true;
      device.lastSeenAt = new Date();
      await em.flush();

      return toResponseDto(device);
    });
  }

  async unregister(user: User, deviceId: string): Promise<void> {
    const device = await this.em.findOne(PushDevice, {
      id: deviceId,
      user: user.id,
    });
    if (!device) {
      throw new NotFoundException({
        code: 'PUSH_DEVICE_NOT_FOUND',
        message: 'Push device not found',
      });
    }
    this.em.remove(device);
    await this.em.flush();
  }
}

function toResponseDto(device: PushDevice): PushDeviceResponseDto {
  return {
    id: device.id,
    platform: device.platform,
    isActive: device.isActive,
    lastSeenAt: device.lastSeenAt.toISOString(),
    createdAt: device.createdAt.toISOString(),
  };
}
