import { Controller, Get } from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { User } from '../users/entities/user.entity';
import { FormalRankOptionsResponseDto } from './dto/formal-rank-options-response.dto';
import { RanksService } from './ranks.service';

// Pure "me" resource, same convention as FormalRankController/
// FormalRankHistoryController (users/me/formal-rank*) - no
// GroupPermissionsGuard, no groupId route param at all: the catalog is
// derived exclusively from @CurrentUser()'s own active
// FormalGroupAffiliation (see RanksService.getFormalRankOptionsForUser),
// so there is nothing here for a caller to redirect at another Group's
// catalog.
@Controller('users/me/formal-rank-options')
export class FormalRankOptionsController {
  constructor(private readonly ranksService: RanksService) {}

  @Get()
  getOptions(@CurrentUser() user: User): Promise<FormalRankOptionsResponseDto> {
    return this.ranksService.getFormalRankOptionsForUser(user.id);
  }
}
