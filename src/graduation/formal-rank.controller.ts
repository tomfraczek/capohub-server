import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Put,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { User } from '../users/entities/user.entity';
import { setFormalRankSchema } from './dto/set-formal-rank.schema';
import type { SetFormalRankInput } from './dto/set-formal-rank.schema';
import { FormalRankAssignmentResponseDto } from './dto/formal-rank-assignment-response.dto';
import { PendingFormalRankResponseDto } from './dto/formal-rank-request-response.dto';
import { FormalRankService } from './formal-rank.service';

// The caller's own current/historical *formal* rank - a global part of
// their profile, never per-Group/per-Section (see the module spec).
// Mirrors UsersController's `me/formal-group` routes in shape/placement,
// but kept in this module rather than UsersModule since every dependency
// it needs (Rank, CustomUserRank, FormalGroupAffiliation) already lives
// here or is reached directly via EntityManager - see graduation.module.ts.
@Controller('users/me/formal-rank')
export class FormalRankController {
  constructor(private readonly formalRankService: FormalRankService) {}

  @Get()
  getCurrent(
    @CurrentUser() user: User,
  ): Promise<FormalRankAssignmentResponseDto> {
    return this.formalRankService.getCurrent(user.id);
  }

  // 200 + the new assignment when confirmed immediately (the caller is
  // their formal Group's OWNER/ADMIN); otherwise 202 + the pending
  // FormalRankRequest - see FormalRankService.setCurrent.
  @Put()
  async setCurrent(
    @CurrentUser() user: User,
    @Body(new ZodValidationPipe(setFormalRankSchema)) dto: SetFormalRankInput,
    @Res({ passthrough: true }) response: Response,
  ): Promise<FormalRankAssignmentResponseDto | PendingFormalRankResponseDto> {
    const result = await this.formalRankService.setCurrent(user, dto);
    if ('pendingRequest' in result) {
      response.status(202);
    }
    return result;
  }

  @Delete()
  @HttpCode(204)
  endCurrent(@CurrentUser() user: User): Promise<void> {
    return this.formalRankService.endCurrent(user);
  }
}

// GET /users/me/formal-rank-history lives on the same `users/me` surface
// but is a distinct read-only resource (the full stint history, not just
// "current"), so it gets its own thin controller rather than overloading
// the one above with a second, differently-shaped GET.
@Controller('users/me/formal-rank-history')
export class FormalRankHistoryController {
  constructor(private readonly formalRankService: FormalRankService) {}

  @Get()
  getHistory(
    @CurrentUser() user: User,
  ): Promise<FormalRankAssignmentResponseDto[]> {
    return this.formalRankService.getHistory(user.id);
  }
}
