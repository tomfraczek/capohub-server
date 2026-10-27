import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Put,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { User } from '../users/entities/user.entity';
import {
  MetronomeSequenceResponseDto,
  MetronomeSequenceSectionDto,
} from './dto/metronome-sequence-response.dto';
import {
  SaveMetronomeSequenceDto,
  saveMetronomeSequenceSchema,
} from './dto/save-metronome-sequence.schema';
import {
  ShareMetronomeSequenceDto,
  shareMetronomeSequenceSchema,
} from './dto/share-metronome-sequence.schema';
import { MetronomeSequencesService } from './metronome-sequences.service';

// The current user's own sequences. Every route acts as @CurrentUser(): the
// owner always comes from the session, never from the body. Other people's
// sequences are reachable only through a Section they are shared in (see
// SectionMetronomeSequencesController).
@Controller('metronome-sequences')
export class MetronomeSequencesController {
  constructor(private readonly service: MetronomeSequencesService) {}

  @Get('mine')
  listMine(@CurrentUser() user: User): Promise<MetronomeSequenceResponseDto[]> {
    return this.service.listMine(user.id);
  }

  // Where "Udostępnij w sekcji" may share (Sections the user owns or
  // administers) - empty means the action isn't offered at all.
  @Get('shareable-sections')
  listShareableSections(
    @CurrentUser() user: User,
  ): Promise<MetronomeSequenceSectionDto[]> {
    return this.service.listShareableSections(user.id);
  }

  // Create-or-replace (201 when created, 200 when replaced).
  @Put(':id')
  async save(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: User,
    @Body(new ZodValidationPipe(saveMetronomeSequenceSchema))
    dto: SaveMetronomeSequenceDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<MetronomeSequenceResponseDto> {
    const { sequence, created } = await this.service.save(user, id, dto);
    res.status(created ? 201 : 200);
    return sequence;
  }

  @Delete(':id')
  @HttpCode(204)
  delete(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: User,
  ): Promise<void> {
    return this.service.delete(user.id, id);
  }

  // The complete set of Sections to share the sequence in; returns where it
  // is shared afterwards.
  @Put(':id/sections')
  setSharedSections(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: User,
    @Body(new ZodValidationPipe(shareMetronomeSequenceSchema))
    dto: ShareMetronomeSequenceDto,
  ): Promise<MetronomeSequenceSectionDto[]> {
    return this.service.setSharedSections(user, id, dto.sectionIds);
  }
}
