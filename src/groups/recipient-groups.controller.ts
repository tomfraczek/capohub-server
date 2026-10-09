import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { User } from '../users/entities/user.entity';
import {
  CreateRecipientGroupDto,
  createRecipientGroupSchema,
} from './dto/create-recipient-group.schema';
import { RecipientGroupEligibleMembersResponseDto } from './dto/recipient-group-eligible-member.dto';
import {
  RecipientGroupEligibleMembersQueryDto,
  recipientGroupEligibleMembersQuerySchema,
} from './dto/recipient-group-eligible-members-query.schema';
import { RecipientGroupResponseDto } from './dto/recipient-group-response.dto';
import {
  UpdateRecipientGroupDto,
  updateRecipientGroupSchema,
} from './dto/update-recipient-group.schema';
import { AllowGroupStatuses } from './decorators/allow-group-statuses.decorator';
import { RequireGroupPermission } from './decorators/require-group-permission.decorator';
import { GroupStatus } from './enums/group-status.enum';
import { GroupPermissionsGuard } from './guards/group-permissions.guard';
import { GroupPermission } from './permissions/group-permission.enum';
import { RecipientGroupsService } from './recipient-groups.service';

const ANY_STATUS = [
  GroupStatus.ACTIVE,
  GroupStatus.READ_ONLY,
  GroupStatus.ARCHIVED,
  GroupStatus.DELETED,
] as const;

// Recipient Group always belongs to exactly one Group-kind entity (a root
// Group or a Section) and is never independently addressable - every route
// is nested under the owning entity, dual-mounted since it can attach at
// any level, same structure as AcademiesController/CohortsController.
@Controller([
  'groups/:groupId/recipient-groups',
  'sections/:sectionId/recipient-groups',
])
@UseGuards(GroupPermissionsGuard)
export class RecipientGroupsController {
  constructor(
    private readonly recipientGroupsService: RecipientGroupsService,
  ) {}

  @Post()
  @HttpCode(201)
  @RequireGroupPermission(GroupPermission.RECIPIENT_GROUP_MANAGE)
  create(
    @Param('groupId') groupId: string,
    @Param('sectionId') sectionId: string,
    @Body(new ZodValidationPipe(createRecipientGroupSchema))
    dto: CreateRecipientGroupDto,
    @CurrentUser() user: User,
  ): Promise<RecipientGroupResponseDto> {
    return this.recipientGroupsService.create(groupId ?? sectionId, dto, user);
  }

  @Get()
  @RequireGroupPermission(GroupPermission.RECIPIENT_GROUP_VIEW)
  @AllowGroupStatuses(...ANY_STATUS)
  list(
    @Param('groupId') groupId: string,
    @Param('sectionId') sectionId: string,
  ): Promise<RecipientGroupResponseDto[]> {
    return this.recipientGroupsService.list(groupId ?? sectionId);
  }

  // Must be declared before the ':recipientGroupId' route below - otherwise
  // "eligible-members" would be matched as a recipientGroupId (Nest/Express
  // resolve routes in registration order, not by specificity - same
  // precedent as AnnouncementsController's 'archive' route).
  @Get('eligible-members')
  @RequireGroupPermission(GroupPermission.RECIPIENT_GROUP_VIEW)
  @AllowGroupStatuses(...ANY_STATUS)
  listEligibleMembers(
    @CurrentUser() user: User,
    @Param('groupId') groupId: string,
    @Param('sectionId') sectionId: string,
    @Query(new ZodValidationPipe(recipientGroupEligibleMembersQuerySchema))
    query: RecipientGroupEligibleMembersQueryDto,
  ): Promise<RecipientGroupEligibleMembersResponseDto> {
    return this.recipientGroupsService.listEligibleMembers(
      groupId ?? sectionId,
      query,
      user.id,
    );
  }

  @Get(':recipientGroupId')
  @RequireGroupPermission(GroupPermission.RECIPIENT_GROUP_VIEW)
  @AllowGroupStatuses(...ANY_STATUS)
  getById(
    @Param('groupId') groupId: string,
    @Param('sectionId') sectionId: string,
    @Param('recipientGroupId', ParseUUIDPipe) recipientGroupId: string,
  ): Promise<RecipientGroupResponseDto> {
    return this.recipientGroupsService.getById(
      groupId ?? sectionId,
      recipientGroupId,
    );
  }

  @Patch(':recipientGroupId')
  @RequireGroupPermission(GroupPermission.RECIPIENT_GROUP_MANAGE)
  update(
    @Param('groupId') groupId: string,
    @Param('sectionId') sectionId: string,
    @Param('recipientGroupId', ParseUUIDPipe) recipientGroupId: string,
    @Body(new ZodValidationPipe(updateRecipientGroupSchema))
    dto: UpdateRecipientGroupDto,
  ): Promise<RecipientGroupResponseDto> {
    return this.recipientGroupsService.update(
      groupId ?? sectionId,
      recipientGroupId,
      dto,
    );
  }

  @Post(':recipientGroupId/activate')
  @RequireGroupPermission(GroupPermission.RECIPIENT_GROUP_MANAGE)
  activate(
    @Param('groupId') groupId: string,
    @Param('sectionId') sectionId: string,
    @Param('recipientGroupId', ParseUUIDPipe) recipientGroupId: string,
  ): Promise<RecipientGroupResponseDto> {
    return this.recipientGroupsService.activate(
      groupId ?? sectionId,
      recipientGroupId,
    );
  }

  @Post(':recipientGroupId/deactivate')
  @RequireGroupPermission(GroupPermission.RECIPIENT_GROUP_MANAGE)
  deactivate(
    @Param('groupId') groupId: string,
    @Param('sectionId') sectionId: string,
    @Param('recipientGroupId', ParseUUIDPipe) recipientGroupId: string,
  ): Promise<RecipientGroupResponseDto> {
    return this.recipientGroupsService.deactivate(
      groupId ?? sectionId,
      recipientGroupId,
    );
  }
}
