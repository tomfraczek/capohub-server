import { randomUUID } from 'node:crypto';

// Centralizes the object-key convention for every resource this module
// uploads an image for (module spec §10). A fresh UUID on every call - the
// caller never reuses a key across two different uploads, even for the
// same resource (module spec: "Nie używaj stale profile.webp/cover.webp" -
// avoids CDN/cache staleness, since a UUID key is immutable and a stale
// cached response can never apply to a new image).

export function buildUserProfileImageKey(userId: string): string {
  return `users/${userId}/profile/${randomUUID()}.webp`;
}

export function buildGroupProfileImageKey(groupId: string): string {
  return `groups/${groupId}/profile/${randomUUID()}.webp`;
}

export function buildSectionProfileImageKey(sectionId: string): string {
  return `sections/${sectionId}/profile/${randomUUID()}.webp`;
}

export function buildEventCoverImageKey(eventId: string): string {
  return `events/${eventId}/cover/${randomUUID()}.webp`;
}

export function buildGroupCoverImageKey(groupId: string): string {
  return `groups/${groupId}/cover/${randomUUID()}.webp`;
}
