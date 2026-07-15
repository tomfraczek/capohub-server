import { Body, Controller, Get, Patch } from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { UpdateUserDto } from './dto/update-user.schema';
import type { UserResponseDto } from './dto/user-response.dto';
import { User } from './entities/user.entity';
import { toUserResponseDto } from './user.mapper';
import { UserService } from './user.service';

@Controller('users')
export class UsersController {
  constructor(private readonly userService: UserService) {}

  @Get('me')
  getMe(@CurrentUser() user: User): UserResponseDto {
    return toUserResponseDto(user);
  }

  @Patch('me')
  async updateMe(
    @CurrentUser() user: User,
    @Body(new ZodValidationPipe(UpdateUserDto.schema)) dto: UpdateUserDto,
  ): Promise<UserResponseDto> {
    const updated = await this.userService.updateProfile(user, dto);
    return toUserResponseDto(updated);
  }
}
