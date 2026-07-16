// SongMedia only stores external links; the backend never hosts audio,
// video or thumbnails itself.
export enum SongMediaProvider {
  YOUTUBE = 'YOUTUBE',
  SPOTIFY = 'SPOTIFY',
  SOUNDCLOUD = 'SOUNDCLOUD',
}
