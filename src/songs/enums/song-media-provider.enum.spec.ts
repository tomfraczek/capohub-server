import { SongMediaProvider } from './song-media-provider.enum';

describe('SongMediaProvider', () => {
  it('defines exactly YOUTUBE, SPOTIFY and SOUNDCLOUD', () => {
    expect(Object.values(SongMediaProvider)).toEqual([
      'YOUTUBE',
      'SPOTIFY',
      'SOUNDCLOUD',
    ]);
  });
});
