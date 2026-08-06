import { Body, Controller, Get, Post } from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { User } from '../users/entities/user.entity';
import { FormalRankCorrectionOwnResponseDto } from './dto/formal-rank-correction-own-response.dto';
import { submitFormalRankCorrectionSchema } from './dto/submit-formal-rank-correction.schema';
import type { SubmitFormalRankCorrectionInput } from './dto/submit-formal-rank-correction.schema';
import { FormalRankCorrectionService } from './formal-rank-correction.service';

// The caller's own active correction workflow, if any - see the module
// spec, rule 3 ("Właściciel profilu nadal widzi..."). Deliberately no
// endpoint to cancel/close this workflow directly - it only ever ends via
// a Section OWNER/ADMIN's approve/reject (see
// formal-rank-corrections.controller.ts).
@Controller('users/me/formal-rank-correction')
export class MyFormalRankCorrectionController {
  constructor(
    private readonly formalRankCorrectionService: FormalRankCorrectionService,
  ) {}

  @Get()
  getMyActive(
    @CurrentUser() user: User,
  ): Promise<FormalRankCorrectionOwnResponseDto> {
    return this.formalRankCorrectionService.getMyActive(user);
  }

  @Post('submit')
  submit(
    @CurrentUser() user: User,
    @Body(new ZodValidationPipe(submitFormalRankCorrectionSchema))
    dto: SubmitFormalRankCorrectionInput,
  ): Promise<FormalRankCorrectionOwnResponseDto> {
    return this.formalRankCorrectionService.submit(user, dto);
  }
}
