// Deliberately just {id, name} - SongDetails.playlists must never expose the
// current user's full playlist objects for a song, per spec section 5.
export interface SongPlaylistRefDto {
  id: string;
  name: string;
}
