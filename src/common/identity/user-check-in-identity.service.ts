import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EntityManager } from '@mikro-orm/postgresql';
import { AppConfigService } from '../../config/app.config';
import { User } from '../../users/entities/user.entity';
import { normalizeUserCodeInput } from '../utils/numeric-code';
import { parseQrPayload } from './qr-payload.util';

// A User's own check-in "scan" method - QR mirrors an in-person scan,
// MANUAL mirrors an organizer typing the code by hand. Reused verbatim as
// Event.checkInMethod's own value (see event-check-in-method.enum.ts) -
// deliberately the same two-value shape, not redefined.
export type CheckInIdentityMethod = 'QR' | 'MANUAL';

export interface ResolvedCheckInIdentity {
  user: User;
  method: CheckInIdentityMethod;
}

// The single place that turns a scanned/typed check-in input into a User -
// reused, unmodified, by both Event and Training check-in (see the module
// spec §3). Deliberately does NOT live in UsersModule: UsersModule already
// imports EventsModule (see users.module.ts), so EventsModule/
// TrainingsModule importing UsersModule back would be circular - this
// service only needs EntityManager and the globally-available
// AppConfigService, so it is provided directly by each module that needs
// it instead (no shared module wrapper needed for one stateless class -
// see events.module.ts/trainings.module.ts).
//
// Accepts exactly two input shapes, matching the identity system's own
// fundamental rule (numericCode and QR are two encodings of the same
// identity):
//  - a numeric code: "123456", "123-456", or the frontend's "U123-456"
//    human-display form (a leading U is stripped before validating - the
//    display prefix is a presentation convention, not part of the stored
//    code),
//  - a User QR payload: "https://<PUBLIC_WEB_BASE_URL's host>/u/123456" -
//    the exact same link "Mój kod"/profile lookup use (see
//    qr-payload.util.ts) - there is only one User identity QR in this
//    app, not a separate check-in-only format. When no public domain is
//    configured, no QR-shaped input can ever resolve here - only the
//    numeric code path can (see parseQrPayload's own comment).
// A well-formed Event QR payload (capohub:v1:<f|w|r|e>:...) is explicitly
// rejected with WRONG_IDENTITY_TYPE, never silently ignored or
// misinterpreted as a numeric code. This service only *identifies* the
// User; it never checks any check-in permission or eligibility itself
// (that is each caller's own concern, after resolving the User here - see
// EventAttendanceService/TrainingAttendanceController).
@Injectable()
export class UserCheckInIdentityService {
  constructor(
    private readonly em: EntityManager,
    private readonly appConfigService: AppConfigService,
  ) {}

  async resolve(
    identity: string,
    em: EntityManager = this.em,
  ): Promise<ResolvedCheckInIdentity> {
    const trimmed = identity.trim();

    const qrPayload = parseQrPayload(
      trimmed,
      this.appConfigService.publicWebBaseUrl,
    );
    if (qrPayload) {
      if (qrPayload.entityType !== 'USER') {
        throw new BadRequestException({
          code: 'WRONG_IDENTITY_TYPE',
          message: 'This QR code identifies an Event, not a User',
        });
      }
      return {
        user: await this.findUserByNumericCodeOrFail(em, qrPayload.numericCode),
        method: 'QR',
      };
    }

    // An optional leading "U" (case-insensitive) - the frontend's
    // human-display form of a User's numericCode, extending the "123-456"
    // convention with the "U" entity-kind letter also used for Event's own
    // F/W/R/E human codes - is accepted (see normalizeUserCodeInput).
    const numericCode = normalizeUserCodeInput(trimmed);
    if (!numericCode) {
      throw new BadRequestException({
        code: 'INVALID_CHECK_IN_IDENTITY',
        message:
          'identity must be a 6-digit numeric code or a valid User QR payload',
      });
    }
    return {
      user: await this.findUserByNumericCodeOrFail(em, numericCode),
      method: 'MANUAL',
    };
  }

  private async findUserByNumericCodeOrFail(
    em: EntityManager,
    numericCode: string,
  ): Promise<User> {
    const user = await em.findOne(User, { numericCode });
    if (!user) {
      throw new NotFoundException({
        code: 'USER_NOT_FOUND',
        message: 'No user matches this identity',
      });
    }
    return user;
  }
}
