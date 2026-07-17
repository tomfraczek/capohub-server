// Response for PUT/DELETE .../vote - deliberately minimal: no voter list,
// no email, no globalRole, no MikroORM entity.
export interface SongMediaVoteResponseDto {
  songId: string;
  mediaId: string;
  voteCount: number;
  isVotedByCurrentUser: boolean;
}
