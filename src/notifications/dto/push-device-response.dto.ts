import { PushPlatform } from '../enums/push-platform.enum';

export interface PushDeviceResponseDto {
  id: string;
  platform: PushPlatform;
  isActive: boolean;
  lastSeenAt: string;
  createdAt: string;
}
