import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { User } from '../users/entities/user.entity';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import {
  assertImageFilePresent,
  imageUploadInterceptor,
} from '../storage/multer-image.interceptor';
import { CancelEventDto, cancelEventSchema } from './dto/cancel-event.schema';
import { EventResponseDto } from './dto/event-response.dto';
import { EventStatusHistoryResponseDto } from './dto/event-status-history-response.dto';
import { UpdateEventDto, updateEventSchema } from './dto/update-event.schema';
import { EventPermissionsGuard } from './guards/event-permissions.guard';
import { RequireEventPermission } from './decorators/require-event-permission.decorator';
import { EventPermission } from './permissions/event-permission.enum';
import { EventsService } from './events.service';
import { EventHistoryService } from './event-history.service';

// Flat, direct-by-id routes (not nested under groupId): once an Event
// exists it is independently addressable (invite links, QR posters,
// check-in) regardless of which community it belongs to - see
// event.entity.ts. Detail reads are visibility-gated inside EventsService,
// never by EventPermissionsGuard (a stranger with no Event role can still
// legitimately view a PUBLIC Event) - the guard only applies to the
// write/management actions below.
@Controller('events/:eventId')
export class EventController {
  constructor(
    private readonly eventsService: EventsService,
    private readonly eventHistoryService: EventHistoryService,
  ) {}

  @Get()
  getById(
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @CurrentUser() user: User,
  ): Promise<EventResponseDto> {
    return this.eventsService.getById(eventId, user);
  }

  @Patch()
  @UseGuards(EventPermissionsGuard)
  @RequireEventPermission(EventPermission.EVENT_EDIT)
  update(
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Body(new ZodValidationPipe(updateEventSchema)) dto: UpdateEventDto,
    @CurrentUser() user: User,
  ): Promise<EventResponseDto> {
    return this.eventsService.update(eventId, dto, user);
  }

  @Post('publish')
  @UseGuards(EventPermissionsGuard)
  @RequireEventPermission(EventPermission.EVENT_PUBLISH)
  publish(
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @CurrentUser() user: User,
  ): Promise<EventResponseDto> {
    return this.eventsService.publish(eventId, user);
  }

  @Post('cancel')
  @UseGuards(EventPermissionsGuard)
  @RequireEventPermission(EventPermission.EVENT_CANCEL)
  cancel(
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Body(new ZodValidationPipe(cancelEventSchema)) dto: CancelEventDto,
    @CurrentUser() user: User,
  ): Promise<EventResponseDto> {
    return this.eventsService.cancel(eventId, dto, user);
  }

  @Post('finish')
  @UseGuards(EventPermissionsGuard)
  @RequireEventPermission(EventPermission.EVENT_FINISH)
  finish(
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @CurrentUser() user: User,
  ): Promise<EventResponseDto> {
    return this.eventsService.finish(eventId, user);
  }

  // Only FINISHED/CANCELLED Events qualify (see ARCHIVABLE_STATUSES in
  // event-write-policy.ts) - gated by EVENT_EDIT, the same trust tier as
  // every other Event-management action (module decision: no new
  // permission for archiving).
  @Post('archive')
  @UseGuards(EventPermissionsGuard)
  @RequireEventPermission(EventPermission.EVENT_EDIT)
  archive(
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @CurrentUser() user: User,
  ): Promise<EventResponseDto> {
    return this.eventsService.archive(eventId, user);
  }

  // PUT/DELETE cover-image (module: "R2: upload/replace/delete zdjęć"
  // §16/§20) - deliberately separate multipart endpoints, not folded into
  // the JSON PATCH above (module spec §16). Same EVENT_EDIT gate as
  // update() - see EventsService.uploadCoverImage/deleteCoverImage for the
  // lifecycle-status rule that blocks this once the Event is
  // FINISHED/CANCELLED/ARCHIVED.
  @Put('cover-image')
  @UseGuards(EventPermissionsGuard)
  @RequireEventPermission(EventPermission.EVENT_EDIT)
  @UseInterceptors(imageUploadInterceptor())
  uploadCoverImage(
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentUser() user: User,
  ): Promise<EventResponseDto> {
    assertImageFilePresent(file);
    return this.eventsService.uploadCoverImage(eventId, file, user);
  }

  @Delete('cover-image')
  @UseGuards(EventPermissionsGuard)
  @RequireEventPermission(EventPermission.EVENT_EDIT)
  deleteCoverImage(
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @CurrentUser() user: User,
  ): Promise<EventResponseDto> {
    return this.eventsService.deleteCoverImage(eventId, user);
  }

  @Get('history')
  @UseGuards(EventPermissionsGuard)
  @RequireEventPermission(EventPermission.EVENT_VIEW_MANAGEMENT)
  history(
    @Param('eventId', ParseUUIDPipe) eventId: string,
  ): Promise<EventStatusHistoryResponseDto[]> {
    return this.eventHistoryService.list(eventId);
  }
}
