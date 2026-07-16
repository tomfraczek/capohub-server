import { Entity, Enum, Index, Property, Unique } from '@mikro-orm/core';
import { GlobalRole } from '../../auth/permissions/global-role.enum';
import { BaseEntity } from '../../database/entities/base.entity';

export const THEMES = ['system', 'light', 'dark'] as const;

export type Theme = (typeof THEMES)[number];

@Entity({ tableName: 'users' })
export class User extends BaseEntity {
  @Unique()
  @Property()
  clerkUserId!: string;

  // Always stored trimmed + lowercased; normalization happens where the
  // value is written (UserService), not here - MikroORM entities stay plain.
  @Index()
  @Property()
  email!: string;

  // Local, app-owned field. Seeded from the Clerk email on first creation
  // (see generateDisplayNameFromEmail) but never overwritten by Clerk sync
  // once set - see UserService.
  @Property({ length: 100 })
  displayName!: string;

  @Property({ nullable: true, type: 'string' })
  avatarUrl: string | null = null;

  @Enum({ items: () => THEMES })
  theme: Theme = 'system';

  @Property()
  notificationsEnabled: boolean = true;

  @Property()
  isActive: boolean = true;

  // Global role only - independent from (future) group-level roles.
  // Never settable via PATCH /users/me; see users.controller.ts.
  @Enum({ items: () => Object.values(GlobalRole) })
  globalRole: GlobalRole = GlobalRole.USER;

  // Set once, when the user is first created - marks the moment of login,
  // not of last activity, so it is never touched on later requests.
  @Property({ type: 'timestamptz', nullable: true })
  lastLoginAt: Date | null = null;
}
