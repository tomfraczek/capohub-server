import { GlobalRole } from './global-role.enum';
import { Permission } from './permission.enum';

// Built hierarchically - each tier spreads the one below it and adds only
// what's new, so a permission is never listed twice. SUPER_ADMIN always
// gets every Permission that exists, automatically.

// Every signed-in USER may add a song to their own queue and edit it while
// it's still theirs (DRAFT/REJECTED) - see the moderation model. It is
// never auto-published: SONG_CREATE only ever produces a DRAFT (see
// SongsService.create), and reaching the public songbook still requires
// CONTENT_APPROVE from someone else entirely (see MODERATOR_PERMISSIONS).
const USER_PERMISSIONS: readonly Permission[] = [
  Permission.SONG_READ,
  Permission.SONG_CREATE,
  Permission.SONG_EDIT_OWN,
];

const EDITOR_PERMISSIONS: readonly Permission[] = [
  ...USER_PERMISSIONS,
  Permission.TRANSLATION_CREATE,
  Permission.TRANSLATION_EDIT,
  Permission.PHONETIC_CREATE,
  Permission.PHONETIC_EDIT,
  Permission.ARTICLE_CREATE,
  Permission.ARTICLE_EDIT,
];

const MODERATOR_PERMISSIONS: readonly Permission[] = [
  ...EDITOR_PERMISSIONS,
  Permission.SONG_EDIT_ANY,
  Permission.ARTICLE_DELETE,
  Permission.CONTENT_APPROVE,
  Permission.CONTENT_HIDE,
];

const ADMIN_PERMISSIONS: readonly Permission[] = [
  ...MODERATOR_PERMISSIONS,
  Permission.SONG_DELETE,
  Permission.USER_MANAGE,
  Permission.MUSIC_CONTENT_MANAGE,
];

// APP_SETTINGS_MANAGE is deliberately withheld from ADMIN and reserved for
// SUPER_ADMIN, so the top tier isn't just ADMIN under a different name.
const SUPER_ADMIN_PERMISSIONS: readonly Permission[] =
  Object.values(Permission);

export const ROLE_PERMISSIONS: Readonly<
  Record<GlobalRole, readonly Permission[]>
> = {
  [GlobalRole.USER]: USER_PERMISSIONS,
  [GlobalRole.EDITOR]: EDITOR_PERMISSIONS,
  [GlobalRole.MODERATOR]: MODERATOR_PERMISSIONS,
  [GlobalRole.ADMIN]: ADMIN_PERMISSIONS,
  [GlobalRole.SUPER_ADMIN]: SUPER_ADMIN_PERMISSIONS,
};
