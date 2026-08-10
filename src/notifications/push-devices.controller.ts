import {
  Body,
  Controller,
  Delete,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { User } from '../users/entities/user.entity';
import { PushDeviceResponseDto } from './dto/push-device-response.dto';
import {
  RegisterPushDeviceDto,
  registerPushDeviceSchema,
} from './dto/register-push-device.schema';
import { PushDevicesService } from './push-devices.service';

@Controller('users/me/push-devices')
export class PushDevicesController {
  constructor(private readonly pushDevicesService: PushDevicesService) {}

  @Post()
  register(
    @Body(new ZodValidationPipe(registerPushDeviceSchema))
    dto: RegisterPushDeviceDto,
    @CurrentUser() user: User,
  ): Promise<PushDeviceResponseDto> {
    return this.pushDevicesService.register(user, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  unregister(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: User,
  ): Promise<void> {
    return this.pushDevicesService.unregister(user, id);
  }
}
