import {
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { User } from '../users/entities/user.entity';
import { MembershipRequestResponseDto } from './dto/membership-request-response.dto';
import { MembershipRequestsService } from './membership-requests.service';

/**
 * Routes for the currently-authenticated user to manage their own invitations.
 * No GroupPermissionsGuard here - these are user-centric, not group-centric.
 */
@Controller('invitations')
export class InvitationsController {
  constructor(
    private readonly membershipRequestsService: MembershipRequestsService,
  ) {}

  /**
   * GET /invitations
   * Returns all PENDING invitations addressed to the current user.
   */
  @Get()
  listReceived(
    @CurrentUser() user: User,
  ): Promise<MembershipRequestResponseDto[]> {
    return this.membershipRequestsService.listReceivedInvitations(user);
  }

  /**
   * POST /invitations/:id/accept
   * Accept a PENDING invitation addressed to the current user.
   */
  @Post(':id/accept')
  @HttpCode(204)
  async accept(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: User,
  ): Promise<void> {
    await this.membershipRequestsService.acceptInvitation(id, user);
  }

  /**
   * POST /invitations/:id/reject
   * Reject a PENDING invitation addressed to the current user.
   */
  @Post(':id/reject')
  @HttpCode(204)
  async reject(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: User,
  ): Promise<void> {
    await this.membershipRequestsService.rejectInvitation(id, user);
  }
}
