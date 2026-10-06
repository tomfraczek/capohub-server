import { Body, Controller, Delete, Get, HttpCode, Put } from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { User } from '../users/entities/user.entity';
import { CustomUserRankService } from './custom-user-rank.service';
import {
  CreateCustomUserRankDto,
  createCustomUserRankSchema,
} from './dto/create-custom-user-rank.schema';
import { CustomUserRankResponseDto } from './dto/custom-user-rank-response.dto';

// The caller's own independent ("custom") cordão - a purely cosmetic,
// non-historical profile element, never a formal rank (see
// custom-user-rank.entity.ts). A true singleton, mirroring
// FormalRankController's own GET/PUT/DELETE shape exactly (see that
// controller) - `users/me/custom-rank`, singular, since there is at most
// one. PUT is an upsert (create-or-replace, see
// CustomUserRankService.setCurrent) - there is no separate POST/create
// route any more.
@Controller('users/me/custom-rank')
export class CustomRankController {
  constructor(private readonly customUserRankService: CustomUserRankService) {}

  @Get()
  getCurrent(@CurrentUser() user: User): Promise<CustomUserRankResponseDto> {
    return this.customUserRankService.getCurrent(user.id);
  }

  @Put()
  setCurrent(
    @CurrentUser() user: User,
    @Body(new ZodValidationPipe(createCustomUserRankSchema))
    dto: CreateCustomUserRankDto,
  ): Promise<CustomUserRankResponseDto> {
    return this.customUserRankService.setCurrent(user, dto);
  }

  @Delete()
  @HttpCode(204)
  deleteCurrent(@CurrentUser() user: User): Promise<void> {
    return this.customUserRankService.deleteCurrent(user);
  }
}
