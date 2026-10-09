// How this user's name is presented to *other* users wherever the app
// shows them as a person (lists, authors, organizers, notifications...) -
// see users/display-name.util.ts, the single place that applies it. The
// preference belongs to the person being shown, never to the viewer.
// Never affects the stored firstName/lastName/apelido, forms that need the
// real name, or the full profile screen (which lays out every identity
// field on its own).
//
//  - FULL_NAME: "Tomasz Frączek" (the default for every account).
//  - TITLE_APELIDO: the current rank's name + apelido, e.g.
//    "Graduado Lagarto" - computed on every read from the active rank
//    (User.currentRankTitle), never stored as a ready-made string.
export enum DisplayNameMode {
  FULL_NAME = 'FULL_NAME',
  TITLE_APELIDO = 'TITLE_APELIDO',
}
