// Endpoints are authorized against these, never against GlobalRole directly.
// Add new permissions here as modules are built; wire them into a role's
// bucket in role-permissions.map.ts.
export enum Permission {
  SONG_READ = 'SONG_READ',
  SONG_CREATE = 'SONG_CREATE',
  SONG_EDIT_OWN = 'SONG_EDIT_OWN',
  SONG_EDIT_ANY = 'SONG_EDIT_ANY',
  SONG_DELETE = 'SONG_DELETE',

  TRANSLATION_CREATE = 'TRANSLATION_CREATE',
  TRANSLATION_EDIT = 'TRANSLATION_EDIT',

  PHONETIC_CREATE = 'PHONETIC_CREATE',
  PHONETIC_EDIT = 'PHONETIC_EDIT',

  ARTICLE_CREATE = 'ARTICLE_CREATE',
  ARTICLE_EDIT = 'ARTICLE_EDIT',
  ARTICLE_DELETE = 'ARTICLE_DELETE',

  CONTENT_APPROVE = 'CONTENT_APPROVE',
  CONTENT_HIDE = 'CONTENT_HIDE',

  USER_MANAGE = 'USER_MANAGE',
  APP_SETTINGS_MANAGE = 'APP_SETTINGS_MANAGE',
}
