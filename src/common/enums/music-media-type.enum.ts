// Shared by Instrument and Rhythm media (see InstrumentMedia/RhythmMedia) -
// unlike SongMediaProvider (which names an external *platform* a link
// points at - YouTube/Spotify/SoundCloud), this names the *kind* of media
// itself, since instrument/rhythm content also includes plain images and
// generic hosted audio/video that SongMediaProvider has no concept of.
export enum MusicMediaType {
  IMAGE = 'IMAGE',
  AUDIO = 'AUDIO',
  VIDEO = 'VIDEO',
  YOUTUBE = 'YOUTUBE',
}
