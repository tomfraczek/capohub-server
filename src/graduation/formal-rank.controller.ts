import { Body, Controller, Delete, Get, HttpCode, Put } from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { User } from '../users/entities/user.entity';
import { setFormalRankSchema } from './dto/set-formal-rank.schema';
import type { SetFormalRankInput } from './dto/set-formal-rank.schema';
import { FormalRankAssignmentResponseDto } from './dto/formal-rank-assignment-response.dto';
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

  @Put()
  setCurrent(
    @CurrentUser() user: User,
    @Body(new ZodValidationPipe(setFormalRankSchema)) dto: SetFormalRankInput,
  ): Promise<FormalRankAssignmentResponseDto> {
    return this.formalRankService.setCurrent(user, dto);
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
