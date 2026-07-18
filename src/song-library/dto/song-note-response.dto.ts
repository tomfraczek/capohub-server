// content is null when the user has no note for this song yet - GET
// .../my-note returns 200 with a null content rather than 404, since "no
// note yet" is a normal state, not an error (mirrors isFavorite=false).
export interface SongNoteResponseDto {
  songId: string;
  content: string | null;
  updatedAt: string | null;
}
