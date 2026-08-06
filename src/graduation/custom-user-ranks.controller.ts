import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { User } from '../users/entities/user.entity';
import { CustomUserRankService } from './custom-user-rank.service';
import {
  CreateCustomUserRankDto,
  createCustomUserRankSchema,
} from './dto/create-custom-user-rank.schema';
import { CustomUserRankResponseDto } from './dto/custom-user-rank-response.dto';
import {
  UpdateCustomUserRankDto,
  updateCustomUserRankSchema,
} from './dto/update-custom-user-rank.schema';

// Every route here is owner-only by construction (see
// CustomUserRankService - every query is scoped by `user: user.id`), so
// there is no permission guard to apply beyond the global auth guard.
@Controller('users/me/custom-ranks')
export class CustomUserRanksController {
  constructor(private readonly customUserRankService: CustomUserRankService) {}

  @Post()
  @HttpCode(201)
  create(
    @CurrentUser() user: User,
    @Body(new ZodValidationPipe(createCustomUserRankSchema))
    dto: CreateCustomUserRankDto,
  ): Promise<CustomUserRankResponseDto> {
    return this.customUserRankService.create(user, dto);
  }

  @Get()
  list(@CurrentUser() user: User): Promise<CustomUserRankResponseDto[]> {
    return this.customUserRankService.list(user);
  }

  @Get(':id')
  getById(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<CustomUserRankResponseDto> {
    return this.customUserRankService.getById(user, id);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateCustomUserRankSchema))
    dto: UpdateCustomUserRankDto,
  ): Promise<CustomUserRankResponseDto> {
    return this.customUserRankService.update(user, id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  delete(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.customUserRankService.delete(user, id);
  }

  // Only permitted without an active FormalGroupAffiliation (see the
  // module spec, rule 7) - never allowed to overlap with a formal rank.
  @Post(':id/activate')
  activate(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<CustomUserRankResponseDto> {
    return this.customUserRankService.activate(user, id);
  }

  @Post(':id/deactivate')
  deactivate(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<CustomUserRankResponseDto> {
    return this.customUserRankService.deactivate(user, id);
  }
}
