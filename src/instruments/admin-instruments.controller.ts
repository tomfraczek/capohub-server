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
  UseGuards,
} from '@nestjs/common';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { Permission } from '../auth/permissions/permission.enum';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { AdminInstrumentListItemDto } from './dto/admin-instrument-list-item.dto';
import {
  CreateInstrumentDto,
  createInstrumentSchema,
} from './dto/create-instrument.schema';
import { InstrumentDetailsResponseDto } from './dto/instrument-details-response.dto';
import {
  UpdateInstrumentDto,
  updateInstrumentSchema,
} from './dto/update-instrument.schema';
import { InstrumentsService } from './instruments.service';

// Every route requires MUSIC_CONTENT_MANAGE (ADMIN tier and up) - CMS-only
// surface, no partial access for editors/moderators (spec section 10).
@Controller('admin/instruments')
@UseGuards(PermissionsGuard)
@Permissions(Permission.MUSIC_CONTENT_MANAGE)
export class AdminInstrumentsController {
  constructor(private readonly instrumentsService: InstrumentsService) {}

  @Get()
  list(): Promise<AdminInstrumentListItemDto[]> {
    return this.instrumentsService.adminList();
  }

  @Get(':id')
  getById(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<InstrumentDetailsResponseDto> {
    return this.instrumentsService.adminGetById(id);
  }

  @Post()
  @HttpCode(201)
  create(
    @Body(new ZodValidationPipe(createInstrumentSchema))
    dto: CreateInstrumentDto,
  ): Promise<InstrumentDetailsResponseDto> {
    return this.instrumentsService.create(dto);
  }

  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateInstrumentSchema))
    dto: UpdateInstrumentDto,
  ): Promise<InstrumentDetailsResponseDto> {
    return this.instrumentsService.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  delete(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.instrumentsService.delete(id);
  }
}
