import {
  Check,
  Entity,
  Enum,
  Formula,
  Index,
  Property,
  Unique,
} from '@mikro-orm/core';
import { GlobalRole } from '../../auth/permissions/global-role.enum';
import { BaseEntity } from '../../database/entities/base.entity';
import { AvatarType } from '../enums/avatar-type.enum';
import { DisplayNameMode } from '../enums/display-name-mode.enum';
import { UserGender } from '../enums/user-gender.enum';

export const THEMES = ['system', 'light', 'dark'] as const;

export type Theme = (typeof THEMES)[number];

export const USERS_NUMERIC_CODE_UNIQUE_INDEX = 'users_numeric_code_unique';

@Entity({ tableName: 'users' })
// Guards numericCode's shape independently of the application-level
// generator (see common/utils/numeric-code.ts).
@Check<User>({
  name: 'users_numeric_code_check',
  expression: (columns) => `"${columns.numericCode}" ~ '^[0-9]{6}$'`,
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

  // Legacy URL field - holds the image URL for CLERK always, and for UPLOAD
  // only pre-R2 (there was no upload endpoint before the R2 storage module,
  // so no real account should ever have avatarType UPLOAD with this set and
  // avatarImageKey null - kept only as a defensive fallback, see
  // storage/image-url.util.ts's resolveUserAvatarUrl). Always null for
  // PRESET. Cleared to null the moment a User uploads their first R2 avatar
  // (see UserService.uploadAvatar) - kept in sync with avatarImageKey below
  // so the two never disagree about which one is authoritative.
  @Property({ nullable: true, type: 'string' })
  avatarUrl: string | null = null;

  // Only meaningful while avatarType is CLERK - mirrors Clerk's own
  // hasImage signal (see UserService.fetchClerkProfile/ClerkProfile): true
  // when avatarUrl is a real uploaded/OAuth-provided photo, false when
  // Clerk is instead returning its own generated initials placeholder for a
  // user who never set one. Ignored for UPLOAD/PRESET. null means "not
  // synced yet" (every pre-existing row at migration time) - deliberately
  // NOT defaulted to true, since that would be a guess with no basis and
  // would let a real placeholder-only account read as "has a photo" until
  // its next authenticated request resyncs this column (see
  // ClerkAuthGuard, which calls findOrCreateFromClerk - and therefore
  // UserService.applyProfileChanges - on every authenticated request, so
  // this null state is only ever observed pre-first-sync). Consumers must
  // treat null the same as false (see mobile's hasProfileAvatar) - never
  // as true.
  @Property({ nullable: true, type: 'boolean' })
  clerkHasImage: boolean | null = null;

  // Only meaningful while avatarType is CLERK *and* the account's Clerk
  // external account is Google (see UserService.syncGoogleHasCustomPhoto /
  // ExternalAccountProvider) - a strictly narrower, more reliable signal
  // than clerkHasImage above. Sourced from the Google People API's
  // `Person.photos[0].default` (verified against the real API: Google's
  // own auto-generated "colored circle with an initial" placeholder comes
  // back as `default: true`, a real uploaded/OAuth-provided photo as
  // `default: false` - clerkHasImage cannot tell these apart, since Google
  // reports `hasImage: true` via Clerk either way). true means a real
  // photo (`default: false`), false means Google's own placeholder
  // (`default: true`), null means "not checked yet, People API failed, or
  // not a Google account" - never defaulted to true, and every one of
  // those null cases must be treated as "not a real photo" by consumers
  // (see mobile's hasProfileAvatar). Deliberately NOT refreshed on every
  // authenticated request (unlike clerkHasImage/avatarUrl above) - the
  // Google People API is only called at the few moments an account's
  // Google avatar is actually being established or explicitly
  // re-synced (account creation, PUT /users/me/avatar/clerk, and the
  // Clerk-fallback branch of DELETE /users/me/profile-image - see
  // UserService), never from the ambient per-request Clerk sync
  // (applyProfileChanges), so GET /users/me never triggers a call to
  // Google.
  @Property({ nullable: true, type: 'boolean' })
  googleHasCustomPhoto: boolean | null = null;

  // Holds the preset identifier (an app-side static asset key) for PRESET;
  // always null for CLERK and UPLOAD. No presets table - the mobile app owns
  // the list of valid ids.
  @Property({ nullable: true, length: 100 })
  presetAvatarId: string | null = null;

  // R2 object key ("users/{id}/profile/{uuid}.webp" - see
  // storage/object-keys.util.ts) for an UPLOAD avatar; always null for
  // CLERK/PRESET. The source of truth for UPLOAD's public avatarUrl once
  // set (see resolveUserAvatarUrl) - a fresh key on every re-upload, never
  // reused, and the previous R2 object is physically deleted on
  // replace/preset-switch/clerk-reset/delete (see UserService - no image
  // history is kept, module: "R2: upload/replace/delete zdjęć").
  @Property({ nullable: true, length: 512 })
  avatarImageKey: string | null = null;

  @Enum({ items: () => THEMES })
  theme: Theme = 'system';

  @Property()
  notificationsEnabled: boolean = true;

  // Regional settings - previously set per-Group at creation time (see the
  // Group/Section physical-split ADR era), moved here so they are set once
  // per-User instead (module: "ustawienia regionalne z poziomu ustawień
  // profilu"). Not (yet) applied anywhere automatically - see
  // group.entity.ts's own comment on why Group no longer carries these.
  // Same IANA-timezone / 3-letter-ISO-4217-shape validation as Section's
  // own timezone/currencyCode (see groups/dto/group-validation.helpers.ts,
  // reused from update-user.schema.ts).
  @Property({ length: 100 })
  timezone: string = 'Europe/Warsaw';

  @Property({ length: 3 })
  currencyCode: string = 'PLN';

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

  // Stable, immutable 6-digit code - a separate namespace/purpose from
  // publicCode above (see the module spec's own framing): easy to type by
  // hand, and the payload behind this User's QR identity (see
  // common/identity/qr-payload.util.ts). Generated exactly once, at
  // account creation (see UserService.findOrCreateFromClerk), via
  // common/utils/numeric-code.ts - never regenerated, never settable
  // through any PATCH. Not a secret and not an authorization token:
  // knowing it only ever resolves this User's already-public profile
  // (still filtered by the normal privacy rules - see
  // UserProfileService.getPublicProfile), the same way publicCode already
  // does.
  @Unique({ name: USERS_NUMERIC_CODE_UNIQUE_INDEX })
  @Property({ length: 6 })
  numericCode!: string;

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
  // apelido is part of the structured profile. Like firstName/lastName it
  // is basic identity and always visible - there is no privacy toggle for
  // any of the three (show_full_name/show_apelido were dropped in
  // Migration20261002100000_DropIdentityPrivacyToggles).
  @Property({ nullable: true, length: 100 })
  apelido: string | null = null;

  @Property({ nullable: true, type: 'date' })
  capoeiraStartedAt: Date | null = null;

  // Self-declared, optional - only ever used to inflect Polish wording
  // about this user ("Dołączył"/"Dołączyła"), so it travels with the user
  // references on the screens that need it. null = not set yet (rendered
  // like UNDISCLOSED: the neutral "Dołączył(a)").
  @Enum({ items: () => Object.values(UserGender), nullable: true })
  gender: UserGender | null = null;

  // How others see this user's name across the app - see
  // users/display-name.util.ts (resolveDisplayName), the only reader.
  // Only the choice is stored, never the resulting string.
  @Enum({ items: () => Object.values(DisplayNameMode) })
  displayNameMode: DisplayNameMode = DisplayNameMode.FULL_NAME;

  // The name of this user's current, *confirmed* rank - the "title" half
  // of DisplayNameMode.TITLE_APELIDO ("Graduado" in "Graduado Lagarto").
  // Read-only and computed by the database on every load (no column, never
  // written), so a promotion shows up the moment the new rank becomes
  // active, with no stored copy to keep in sync. Same rule as
  // FormalRankService.getCurrentOrNull/CustomUserRankService
  // .getCurrentOrNull: the active FormalRankAssignment (endedOn null - only
  // ever written on approval, so a PENDING FormalRankRequest never counts
  // and the previous rank stays until then), else the active independent
  // CustomUserRank; at most one of the two is ever active (see
  // graduation/rank-transitions.ts). Both lookups hit their partial unique
  // "user_id where ended_on is null" index. Not privacy-filtered here -
  // resolveDisplayName applies showFormalRank. `undefined` on an entity
  // that was created (not loaded) in the current request.
  @Formula(
    (table) =>
      // Aliases prefixed `dnt_` so they can never shadow the outer
      // query's own alias (MikroORM's are e0, u1, ...).
      `coalesce(` +
      `(select dnt_r.name from formal_rank_assignments dnt_fra join ranks dnt_r on dnt_r.id = dnt_fra.rank_id where dnt_fra.user_id = ${table.alias}.id and dnt_fra.ended_on is null limit 1), ` +
      `(select dnt_cur.name from custom_user_ranks dnt_cur where dnt_cur.user_id = ${table.alias}.id and dnt_cur.ended_on is null limit 1))`,
    { type: 'string', nullable: true },
  )
  currentRankTitle?: string | null;

  // Private contact/personal data - returned on the owner's own profile
  // (UserProfileResponseDto) and to the staff of an Event this user is
  // registered for (EventParticipantResponseDto, together with
  // firstName/lastName). Never on PublicUserProfileResponseDto or any
  // search/list DTO, and deliberately with no privacy toggle.
  @Property({ nullable: true, type: 'date' })
  birthDate: Date | null = null;

  // Stored as entered (trimmed) - see update-user-profile.schema.ts for the
  // accepted format. No uniqueness or verification: not used for auth.
  @Property({ nullable: true, length: 32 })
  phoneNumber: string | null = null;

  // ─── Profile privacy (see UserProfileService.getPublicProfile) ────────
  // All default true (visible) - a freshly created profile shows every
  // field below (see PublicUserProfileResponseDto) until the owner
  // explicitly opts a field out. Plain booleans, not a general ACL: each
  // one gates exactly one profile field/list, described on
  // PublicUserProfileResponseDto. Basic identity (firstName/lastName/
  // apelido) is deliberately NOT among them - it is always visible.
  @Property()
  showCapoeiraStartedAt: boolean = true;

  // Gates the `sections` list on the public profile (current
  // SectionMembership only - never role/status data). There is
  // deliberately no equivalent "showGroups" - a Group has no membership,
  // so the only thing such a list could show is which Groups this user
  // administers (OWNER/ADMIN RoleAssignment), and surfacing that on a
  // public profile would leak an administrative fact through a field that
  // reads as ordinary membership.
  @Property()
  showSections: boolean = true;

  @Property()
  showFormalGroup: boolean = true;

  @Property()
  showFormalRank: boolean = true;

  // Gates the whole GET /users/:userId/career-timeline endpoint - see
  // career-timeline.service.ts. Per-category toggles were deliberately
  // rejected in favor of this single switch (see the module spec); the
  // underlying source data (formal group, formal rank, event
  // participation) still applies its own privacy toggle on top of this one.
  @Property()
  showCareerTimeline: boolean = true;

  // Gates whether this user's participation in an Event (EventAttendee row)
  // may ever be revealed to a viewer other than the owner - both directly
  // (a future "who's attending" surface) and via the career timeline's
  // EVENT entries. No such toggle existed before the career timeline
  // module.
  @Property()
  showEventParticipation: boolean = true;
}
