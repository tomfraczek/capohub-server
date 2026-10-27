import {
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { PaginatedResponse } from '../common/pagination/pagination.types';
import { paginationQuerySchema } from '../common/pagination/pagination-query.schema';
import type { PaginationQuery } from '../common/pagination/pagination-query.schema';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { RequireGroupPermission } from '../groups/decorators/require-group-permission.decorator';
import { GroupPermissionsGuard } from '../groups/guards/group-permissions.guard';
import { GroupPermission } from '../groups/permissions/group-permission.enum';
import { User } from '../users/entities/user.entity';
import {
  MetronomeSequenceResponseDto,
  SectionMetronomeSequenceResponseDto,
} from './dto/metronome-sequence-response.dto';
import { MetronomeSequencesService } from './metronome-sequences.service';

// "Metronom - zapisane sekwencje" of one Section. GroupPermissionsGuard
// applies the Section's own membership rules: members (READ_ONLY included)
// browse, play and copy; OWNER/ADMIN also remove; anyone else gets 404.
@Controller('sections/:sectionId/metronome-sequences')
@UseGuards(GroupPermissionsGuard)
export class SectionMetronomeSequencesController {
  constructor(private readonly service: MetronomeSequencesService) {}

  @Get()
  @RequireGroupPermission(GroupPermission.METRONOME_SEQUENCE_VIEW)
  list(
    @Param('sectionId', ParseUUIDPipe) sectionId: string,
    @CurrentUser() user: User,
    @Query(new ZodValidationPipe(paginationQuerySchema)) query: PaginationQuery,
  ): Promise<PaginatedResponse<SectionMetronomeSequenceResponseDto>> {
    return this.service.listInSection(sectionId, user.id, query);
  }

  // Removes the sequence from this Section's library only.
  @Delete(':sequenceId')
  @HttpCode(204)
  @RequireGroupPermission(GroupPermission.METRONOME_SEQUENCE_SHARE)
  remove(
    @Param('sectionId', ParseUUIDPipe) sectionId: string,
    @Param('sequenceId', ParseUUIDPipe) sequenceId: string,
  ): Promise<void> {
    return this.service.removeFromSection(sectionId, sequenceId);
  }

  // "Zapisz u siebie" (201 when copied, 200 when an identical copy existed).
  @Post(':sequenceId/copies')
  @RequireGroupPermission(GroupPermission.METRONOME_SEQUENCE_VIEW)
  async copy(
    @Param('sectionId', ParseUUIDPipe) sectionId: string,
    @Param('sequenceId', ParseUUIDPipe) sequenceId: string,
    @CurrentUser() user: User,
    @Res({ passthrough: true }) res: Response,
  ): Promise<MetronomeSequenceResponseDto> {
    const { sequence, created } = await this.service.copyFromSection(
      user,
      sectionId,
      sequenceId,
    );
    res.status(created ? 201 : 200);
    return sequence;
  }
}
