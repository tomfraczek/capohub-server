import { AvatarType } from '../../users/enums/avatar-type.enum';

// The single publicly-presented identity behind an Event - see
// event-community.util.ts for how this differs from `createdBy` (audit
// provenance) and EventRole.OWNER (a transferable administrative role).
// Discriminated on `type`: exactly one of Event's three organizer fields
// (organizerUser / communityGroup / communitySection) is ever set (see
// event.entity.ts's events_organizer_check), so this DTO always resolves
// to exactly one of the two branches below, never a partial/empty shape.
//
// Never include email, clerkUserId, globalRole or any other private User
// field here (mirrors GroupUserRefDto's own rule) - displayName and the
// avatar fields are already public-safe elsewhere in this codebase.

// Mirrors User.avatarType/avatarUrl/presetAvatarId (see user.entity.ts)
// rather than collapsing to a single `imageUrl` - a PRESET avatar has no
// URL at all; the app resolves `presetAvatarId` to an asset locally.
export interface EventOrganizerUserImageDto {
  type: AvatarType;
  url: string | null;
  presetAvatarId: string | null;
}

export interface EventOrganizerUserRefDto {
  type: 'USER';
  // Null when the organizing User account no longer exists (see
  // UserService.deleteLocalAccountData - organizerUser is ON DELETE SET
  // NULL) - `name` still resolves via the historical snapshot taken at
  // creation (see event.entity.ts's organizerUserDisplayName), but there is
  // no live profile left to link to, so the frontend must never render this
  // as a clickable active profile.
  id: string | null;
  name: string;
  // Null alongside `id` for the same reason - this codebase does not keep
  // historical copies of profile images (see event.entity.ts's own
  // comment), so a deleted-account organizer simply has no image; the
  // frontend falls back to initials, same as any User with no avatar.
  image: EventOrganizerUserImageDto | null;
}

export interface EventOrganizerCommunityRefDto {
  type: 'GROUP' | 'SECTION';
  id: string;
  name: string;
  // Today always Group.logoUrl/Section.logoUrl passed straight through -
  // a later storage/R2 task may change how this URL is produced without
  // changing this DTO's shape.
  image: { url: string | null };
}

export type EventOrganizerRefDto =
  EventOrganizerUserRefDto | EventOrganizerCommunityRefDto;
