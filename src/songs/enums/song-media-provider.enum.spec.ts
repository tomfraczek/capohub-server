import { SongMediaProvider } from './song-media-provider.enum';

describe('SongMediaProvider', () => {
  it('defines exactly YOUTUBE, SPOTIFY, SOUNDCLOUD and VIMEO', () => {
    expect(Object.values(SongMediaProvider)).toEqual([
      'YOUTUBE',
      'SPOTIFY',
      'SOUNDCLOUD',
      'VIMEO',
    ]);
  });
});
