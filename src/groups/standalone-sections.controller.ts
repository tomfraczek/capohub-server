import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { User } from '../users/entities/user.entity';
import {
  CreateSectionDto,
  createSectionSchema,
} from './dto/create-section.schema';
import { SectionResponseDto } from './dto/section-response.dto';
import { SectionsService } from './sections.service';

// Creates a standalone Section - no parent Group at all (see ADR-032). A
// deliberately separate controller/route from SectionsController
// (`POST /groups/:groupId/sections`), not a body-level variant of it: that
// endpoint means "create a Section under this exact Group" and always will;
// this one means "create an independent Section", with no route param to
// even express a parent. Collapsing the two into one endpoint (e.g. an
// optional `parentGroupId` body field) would blur that distinction, so they
// stay separate here too.
//
// No GroupPermissionsGuard - there is no group/section id in the route for
// it to resolve, and none is needed: creating a standalone Section requires
// no permission at all, exactly like POST /groups (see GroupsService.create
// and SectionsService.createStandalone's own comment). The global
// ClerkAuthGuard (see auth.module.ts) still requires the caller to be
// authenticated.
@Controller('sections')
export class StandaloneSectionsController {
  constructor(private readonly sectionsService: SectionsService) {}

  @Post()
  @HttpCode(201)
  create(
    @CurrentUser() user: User,
    @Body(new ZodValidationPipe(createSectionSchema)) dto: CreateSectionDto,
  ): Promise<SectionResponseDto> {
    return this.sectionsService.createStandalone(user, dto);
  }
}
