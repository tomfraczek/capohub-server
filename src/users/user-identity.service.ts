import { Injectable } from '@nestjs/common';
import { EntityManager } from '@mikro-orm/postgresql';
import { User } from './entities/user.entity';

/**
 * The single place that resolves a User by its numericCode - used today by
 * UsersController's lookup endpoint (GET users/by-code/:code), and shaped
 * to be reusable, unmodified, by a future attendance/check-in flow (e.g.
 * `recordAttendance(trainingId, userId, actor)` once a trainer scans a
 * User QR - see the module spec §12). Deliberately does not itself resolve
 * QR payloads (see common/identity/qr-payload.util.ts for that) or check
 * any permission beyond "does this code identify a User at all" - a caller
 * needing attendance/check-in authority must check that itself, in its own
 * module, after resolving the User here.
 */
@Injectable()
export class UserIdentityService {
  constructor(private readonly em: EntityManager) {}

  async resolveUserByNumericCode(
    numericCode: string,
    em: EntityManager = this.em,
  ): Promise<User | null> {
    return em.findOne(User, { numericCode });
  }
}
