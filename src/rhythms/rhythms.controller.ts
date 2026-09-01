import { Controller, Get, Param, Query } from '@nestjs/common';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { RhythmDetailsResponseDto } from './dto/rhythm-details-response.dto';
import { RhythmListItemResponseDto } from './dto/rhythm-list-item-response.dto';
import {
  RhythmListQueryDto,
  rhythmListQuerySchema,
} from './dto/rhythm-list-query.schema';
import { RhythmsService } from './rhythms.service';

// Public catalogue, gated only by the global ClerkAuthGuard (any
// authenticated app user) - no special Permission, same as GET /songs.
@Controller('rhythms')
export class RhythmsController {
  constructor(private readonly rhythmsService: RhythmsService) {}

  @Get()
  list(
    @Query(new ZodValidationPipe(rhythmListQuerySchema))
    query: RhythmListQueryDto,
  ): Promise<RhythmListItemResponseDto[]> {
    return this.rhythmsService.listPublic(query.search, query.instrumentId);
  }

  @Get(':slug')
  getBySlug(@Param('slug') slug: string): Promise<RhythmDetailsResponseDto> {
    return this.rhythmsService.getPublicBySlug(slug);
  }
}
