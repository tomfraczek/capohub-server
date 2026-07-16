import { SongMediaProvider } from '../enums/song-media-provider.enum';
import { SongMedia } from './song-media.entity';

describe('SongMedia', () => {
  it('holds a provider alongside its url', () => {
    const media = new SongMedia();
    media.provider = SongMediaProvider.YOUTUBE;
    media.url = 'https://www.youtube.com/watch?v=example';

    expect(media.provider).toBe(SongMediaProvider.YOUTUBE);
    expect(media.url).toBe('https://www.youtube.com/watch?v=example');
  });

  it('defaults createdBy to null', () => {
    const media = new SongMedia();
    expect(media.createdBy).toBeNull();
  });

  it('defaults title to null', () => {
    const media = new SongMedia();
    expect(media.title).toBeNull();
  });

  it('defaults isVerified to false', () => {
    const media = new SongMedia();
    expect(media.isVerified).toBe(false);
  });
});
