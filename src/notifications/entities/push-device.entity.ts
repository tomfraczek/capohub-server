import {
  Entity,
  Enum,
  Index,
  ManyToOne,
  Property,
  Unique,
} from '@mikro-orm/core';
import { BaseEntity } from '../../database/entities/base.entity';
import { User } from '../../users/entities/user.entity';
import { PushPlatform } from '../enums/push-platform.enum';

export const PUSH_DEVICES_TOKEN_UNIQUE_INDEX =
  'push_devices_expo_push_token_unique';

// One row per (installed app instance, Expo push token). A User may hold
// any number of active devices at once (module spec section 13). `token`
// is globally unique, not per-user: if the same Expo token is registered
// again under a different User (a reinstall / different account signed in
// on the same physical device), PushDevicesService reassigns `user` on the
// existing row rather than creating a duplicate, so a stale token can never
// silently keep delivering to the previous owner (module spec section 14).
@Entity({ tableName: 'push_devices' })
export class PushDevice extends BaseEntity {
  @Index()
  @ManyToOne(() => User, { deleteRule: 'cascade' })
  user!: User;

  @Unique({ name: PUSH_DEVICES_TOKEN_UNIQUE_INDEX })
  @Property({ length: 400 })
  expoPushToken!: string;

  @Enum({ items: () => Object.values(PushPlatform) })
  platform!: PushPlatform;

  // No stable installationId is sent by the frontend yet (module spec
  // section 13 - "nie wymyślaj skomplikowanego device fingerprintingu"), so
  // this starts out unused; token uniqueness alone is enough to identify a
  // device today.
  @Property({ nullable: true, length: 200 })
  installationId: string | null = null;

  // False once Expo reports this token as permanently invalid
  // (DeviceNotRegistered or equivalent - see NotificationPushService). A
  // transient delivery error never touches this flag.
  @Index()
  @Property()
  isActive: boolean = true;

  @Property({ type: 'timestamptz' })
  lastSeenAt: Date = new Date();
}
