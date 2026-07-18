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
import { AdminRhythmListItemDto } from './dto/admin-rhythm-list-item.dto';
import {
  CreateRhythmDto,
  createRhythmSchema,
} from './dto/create-rhythm.schema';
import { RhythmDetailsResponseDto } from './dto/rhythm-details-response.dto';
import {
  UpdateRhythmDto,
  updateRhythmSchema,
} from './dto/update-rhythm.schema';
import { RhythmsService } from './rhythms.service';

// Every route requires MUSIC_CONTENT_MANAGE (ADMIN tier and up) - CMS-only
// surface (spec section 10).
@Controller('admin/rhythms')
@UseGuards(PermissionsGuard)
@Permissions(Permission.MUSIC_CONTENT_MANAGE)
export class AdminRhythmsController {
  constructor(private readonly rhythmsService: RhythmsService) {}

  @Get()
  list(): Promise<AdminRhythmListItemDto[]> {
    return this.rhythmsService.adminList();
  }

  @Get(':id')
  getById(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<RhythmDetailsResponseDto> {
    return this.rhythmsService.adminGetById(id);
  }

  @Post()
  @HttpCode(201)
  create(
    @Body(new ZodValidationPipe(createRhythmSchema)) dto: CreateRhythmDto,
  ): Promise<RhythmDetailsResponseDto> {
    return this.rhythmsService.create(dto);
  }

  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateRhythmSchema)) dto: UpdateRhythmDto,
  ): Promise<RhythmDetailsResponseDto> {
    return this.rhythmsService.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  delete(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.rhythmsService.delete(id);
  }
}
