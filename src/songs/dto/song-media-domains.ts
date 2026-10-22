import { SongMediaProvider } from '../enums/song-media-provider.enum';

// Backend never fetches these URLs or their metadata - only the domain is
// checked, against this fixed allowlist per provider.
export const ALLOWED_MEDIA_HOSTS: Record<SongMediaProvider, readonly string[]> =
  {
    [SongMediaProvider.YOUTUBE]: [
      'youtube.com',
      'www.youtube.com',
      'm.youtube.com',
      'youtu.be',
      'music.youtube.com',
    ],
    [SongMediaProvider.SPOTIFY]: ['open.spotify.com'],
    [SongMediaProvider.SOUNDCLOUD]: ['soundcloud.com', 'www.soundcloud.com'],
    [SongMediaProvider.VIMEO]: [
      'vimeo.com',
      'www.vimeo.com',
      'player.vimeo.com',
    ],
  };

export function isValidMediaUrlForProvider(
  provider: SongMediaProvider,
  url: string,
): boolean {
  let parsed: URL;

  try {
    parsed = new URL(url);
  } catch {
    return false;
  }

  if (parsed.protocol !== 'https:') {
    return false;
  }

  return ALLOWED_MEDIA_HOSTS[provider].includes(parsed.hostname.toLowerCase());
}
