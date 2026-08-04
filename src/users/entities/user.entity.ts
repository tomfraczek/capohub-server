import { Entity, Enum, Index, Property, Unique } from '@mikro-orm/core';
import { GlobalRole } from '../../auth/permissions/global-role.enum';
import { BaseEntity } from '../../database/entities/base.entity';
import { AvatarType } from '../enums/avatar-type.enum';

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

  // Which of the three sources (Clerk / own upload / built-in preset) the
  // current avatar comes from. Consistency between avatarType, avatarUrl and
  // presetAvatarId is enforced in UserService, not here - see the methods
  // that mutate these three fields together.
  @Enum({ items: () => Object.values(AvatarType) })
  avatarType: AvatarType = AvatarType.CLERK;

  // Holds the image URL for CLERK and UPLOAD; always null for PRESET.
  @Property({ nullable: true, type: 'string' })
  avatarUrl: string | null = null;

  // Holds the preset identifier (an app-side static asset key) for PRESET;
  // always null for CLERK and UPLOAD. No presets table - the mobile app owns
  // the list of valid ids.
  @Property({ nullable: true, length: 100 })
  presetAvatarId: string | null = null;

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

  // Globally-unique, immutable, human-readable code for locating this User
  // without knowing their UUID.  Generated once at account creation (see
  // UserService.create/generateUniquePublicCode) and never changed - the DB
  // column has always been NOT NULL (see
  // Migration20260721_AddPublicCodeAndMembershipRequests); `nullable: true`
  // here was metadata drift against that, not an intentional relaxation.
  // Never used as an authorization token.
  @Unique()
  @Property({ length: 15 })
  publicCode!: string;
}
