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
import { CareerTimelineEntriesService } from './career-timeline-entries.service';
import {
  CreateCareerTimelineEntryDto,
  createCareerTimelineEntrySchema,
  UpdateCareerTimelineEntryDto,
  updateCareerTimelineEntrySchema,
} from './dto/career-timeline-entry-input.schema';
import { CustomTimelineItemDto } from './dto/career-timeline-item.dto';

// CRUD for the caller's own manual timeline entries (see the module spec,
// "Ręczne wpisy timeline"). Every route here is owner-only by construction
// (every query in CareerTimelineEntriesService is scoped by `user: user.id`),
// same as CustomRankController - no permission guard beyond the global
// auth guard is needed. Responses reuse CustomTimelineItemDto (the same
// shape a CUSTOM entry takes inside the aggregated timeline) rather than a
// second, parallel "raw entry" DTO.
@Controller('users/me/career-timeline-entries')
export class CareerTimelineEntriesController {
  constructor(private readonly entriesService: CareerTimelineEntriesService) {}

  @Post()
  @HttpCode(201)
  create(
    @CurrentUser() user: User,
    @Body(new ZodValidationPipe(createCareerTimelineEntrySchema))
    dto: CreateCareerTimelineEntryDto,
  ): Promise<CustomTimelineItemDto> {
    return this.entriesService.create(user, dto);
  }

  @Get()
  list(@CurrentUser() user: User): Promise<CustomTimelineItemDto[]> {
    return this.entriesService.list(user);
  }

  @Get(':id')
  getById(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<CustomTimelineItemDto> {
    return this.entriesService.getById(user, id);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateCareerTimelineEntrySchema))
    dto: UpdateCareerTimelineEntryDto,
  ): Promise<CustomTimelineItemDto> {
    return this.entriesService.update(user, id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  delete(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.entriesService.delete(user, id);
  }
}
