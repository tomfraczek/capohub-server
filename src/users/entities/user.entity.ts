import { Check, Entity, Enum, Index, Property, Unique } from '@mikro-orm/core';
import { GlobalRole } from '../../auth/permissions/global-role.enum';
import { BaseEntity } from '../../database/entities/base.entity';
import { AvatarType } from '../enums/avatar-type.enum';

export const THEMES = ['system', 'light', 'dark'] as const;

export type Theme = (typeof THEMES)[number];

@Entity({ tableName: 'users' })
// Mirrors sections_country_check (see section.entity.ts) - same ISO
// 3166-1 alpha-2 shape, same reason for a DB-level backstop alongside the
// application-level normalization in UserProfileService.
@Check<User>({
  name: 'users_country_check',
  expression: (columns) =>
    `"${columns.country}" is null or "${columns.country}" ~ '^[A-Z]{2}$'`,
})
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

  // ─── Profile (see UserProfileService / GET,PATCH /users/me/profile) ───
  // firstName/lastName are business-required (see profileComplete on
  // UserProfileResponseDto) but stay nullable at the DB level: this field
  // set is new, so every pre-existing account starts out incomplete, with
  // no reliable source to backfill a real first/last name split from (see
  // the migration for the accounts this affected at introduction time).
  // UpdateUserProfileDto enforces "non-empty if provided, never settable
  // back to null" - once both are set, profileComplete never reverts.
  @Property({ nullable: true, length: 100 })
  firstName: string | null = null;

  @Property({ nullable: true, length: 100 })
  lastName: string | null = null;

  // Nickname - distinct from displayName (see that field's own comment):
  // apelido is part of the structured profile and subject to its own
  // privacy toggle, while displayName is the pre-existing, always-shown
  // account label with no privacy control of its own.
  @Property({ nullable: true, length: 100 })
  apelido: string | null = null;

  @Property({ nullable: true, length: 100 })
  city: string | null = null;

  // ISO 3166-1 alpha-2, uppercase - same convention as Section.country
  // (see section.entity.ts), normalized to uppercase in
  // UserProfileService before being persisted.
  @Property({ nullable: true, length: 2 })
  country: string | null = null;

  @Property({ nullable: true, type: 'date' })
  capoeiraStartedAt: Date | null = null;

  // ─── Profile privacy (see UserProfileService.getPublicProfile) ────────
  // All default false (private) - a freshly created profile shows nothing
  // beyond the safe name fallback (see PublicUserProfileResponseDto) until
  // the owner explicitly opts a field in. Plain booleans, not a general
  // ACL: each one gates exactly one profile field/list, described on
  // PublicUserProfileResponseDto.
  @Property()
  showFullName: boolean = false;

  @Property()
  showApelido: boolean = false;

  // Gates city + country together - the spec treats "location" as one
  // disclosure decision, not two.
  @Property()
  showLocation: boolean = false;

  @Property()
  showCapoeiraStartedAt: boolean = false;

  // Gates the `sections` list on the public profile (current
  // SectionMembership only - never role/status data). There is
  // deliberately no equivalent "showGroups" - a Group has no membership,
  // so the only thing such a list could show is which Groups this user
  // administers (OWNER/ADMIN RoleAssignment), and surfacing that on a
  // public profile would leak an administrative fact through a field that
  // reads as ordinary membership.
  @Property()
  showSections: boolean = false;

  @Property()
  showFormalGroup: boolean = false;
}
