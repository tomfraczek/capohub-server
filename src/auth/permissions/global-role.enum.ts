// Global roles only. Group-level roles are a separate, later concern and
// must not be modeled here.
export enum GlobalRole {
  USER = 'USER',
  EDITOR = 'EDITOR',
  MODERATOR = 'MODERATOR',
  ADMIN = 'ADMIN',
  SUPER_ADMIN = 'SUPER_ADMIN',
}
