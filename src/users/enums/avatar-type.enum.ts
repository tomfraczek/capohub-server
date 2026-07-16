// Source of the user's avatar image. GOOGLE is deliberately not a value:
// Clerk is the only upstream identity provider this app talks to, even when
// the end user authenticated via Google through Clerk.
export enum AvatarType {
  CLERK = 'CLERK',
  UPLOAD = 'UPLOAD',
  PRESET = 'PRESET',
}
