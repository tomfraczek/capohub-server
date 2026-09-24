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
import {
  CreateSavedLocationDto,
  createSavedLocationSchema,
} from './dto/create-saved-location.schema';
import { SavedLocationResponseDto } from './dto/saved-location-response.dto';
import {
  UpdateSavedLocationDto,
  updateSavedLocationSchema,
} from './dto/update-saved-location.schema';
import { User } from './entities/user.entity';
import { SavedLocationsService } from './saved-locations.service';

// CRUD for the caller's own saved locations (replaces the old
// GET/PUT/DELETE .../me/discovery-location - see SavedLocation's own
// comment). Every route is owner-only by construction (every
// SavedLocationsService query is scoped by `user: user.id`), same as
// CareerTimelineEntriesController - no permission guard beyond the global
// auth guard is needed.
@Controller('users/me/locations')
export class SavedLocationsController {
  constructor(private readonly savedLocationsService: SavedLocationsService) {}

  @Get()
  list(@CurrentUser() user: User): Promise<SavedLocationResponseDto[]> {
    return this.savedLocationsService.list(user);
  }

  @Post()
  @HttpCode(201)
  create(
    @CurrentUser() user: User,
    @Body(new ZodValidationPipe(createSavedLocationSchema))
    dto: CreateSavedLocationDto,
  ): Promise<SavedLocationResponseDto> {
    return this.savedLocationsService.create(user, dto);
  }

  @Patch(':locationId')
  update(
    @CurrentUser() user: User,
    @Param('locationId', ParseUUIDPipe) locationId: string,
    @Body(new ZodValidationPipe(updateSavedLocationSchema))
    dto: UpdateSavedLocationDto,
  ): Promise<SavedLocationResponseDto> {
    return this.savedLocationsService.update(user, locationId, dto);
  }

  @Delete(':locationId')
  @HttpCode(204)
  delete(
    @CurrentUser() user: User,
    @Param('locationId', ParseUUIDPipe) locationId: string,
  ): Promise<void> {
    return this.savedLocationsService.delete(user, locationId);
  }
}
