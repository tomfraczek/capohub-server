import { Controller, Get, Param, Query } from '@nestjs/common';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { InstrumentDetailsResponseDto } from './dto/instrument-details-response.dto';
import { InstrumentListItemResponseDto } from './dto/instrument-list-item-response.dto';
import {
  InstrumentListQueryDto,
  instrumentListQuerySchema,
} from './dto/instrument-list-query.schema';
import { InstrumentsService } from './instruments.service';

// Public catalogue, gated only by the global ClerkAuthGuard (any
// authenticated app user) - no special Permission, same as GET /songs.
@Controller('instruments')
export class InstrumentsController {
  constructor(private readonly instrumentsService: InstrumentsService) {}

  @Get()
  list(
    @Query(new ZodValidationPipe(instrumentListQuerySchema))
    query: InstrumentListQueryDto,
  ): Promise<InstrumentListItemResponseDto[]> {
    return this.instrumentsService.listPublic(query.search);
  }

  @Get(':slug')
  getBySlug(
    @Param('slug') slug: string,
  ): Promise<InstrumentDetailsResponseDto> {
    return this.instrumentsService.getPublicBySlug(slug);
  }
}
