import { SectionMemberUserImageDto } from '../../groups/dto/section-member-user-ref.dto';
import { UserGender } from '../../users/enums/user-gender.enum';
import { FormalRankRequestStatus } from '../enums/formal-rank-request-status.enum';
import { RankTrack } from '../enums/rank-track.enum';
import { CordSegmentResponseDto } from './rank-response.dto';

export interface FormalRankRequestRankDto {
  id: string;
  name: string;
  track: RankTrack;
  cordSegments: CordSegmentResponseDto[];
}

// The requester's own view (GET /users/me/formal-rank-request, and PUT
// /users/me/formal-rank's 202 body).
export interface OwnFormalRankRequestResponseDto {
  id: string;
  status: FormalRankRequestStatus;
  group: { id: string; name: string };
  rank: FormalRankRequestRankDto;
  startedOn: string | null;
  awardedByName: string | null;
  createdAt: string;
}

// PUT /users/me/formal-rank answers 202 with this when the choice needs
// confirmation (the caller is not their formal Group's OWNER/ADMIN).
export interface PendingFormalRankResponseDto {
  pendingRequest: OwnFormalRankRequestResponseDto;
}

// GET /users/me/formal-rank-request - `request` is null when nothing is
// pending (a plain 200, unlike RANK_NOT_SET's 404: "nothing pending" is
// the ordinary state, polled by the Capoeira hub).
export interface OwnFormalRankRequestStateDto {
  request: OwnFormalRankRequestResponseDto | null;
}

// What a reviewer needs to decide (Ustawienia grupy > Moderacja > "Prośby o
// potwierdzenie stopnia"): who, what they hold now and where it comes
// from, and what they want confirmed here. The requester's own current
// rank is shown regardless of their profile privacy toggles - they sent
// their rank to this Group's reviewers to be judged.
export interface GroupFormalRankRequestResponseDto {
  id: string;
  user: {
    id: string;
    displayName: string;
    apelido: string | null;
    image: SectionMemberUserImageDto;
    // So a reviewer's corrected pick from the catalog is shown in the
    // requester's form of the title - see rank-name.util.ts. currentRank/
    // requestedRank below already are.
    gender: UserGender | null;
  };
  currentRank: {
    name: string;
    cordSegments: CordSegmentResponseDto[];
    source: 'FORMAL_GROUP' | 'INDEPENDENT';
    sourceGroup: { id: string; name: string } | null;
  } | null;
  requestedRank: FormalRankRequestRankDto;
  startedOn: string | null;
  awardedByName: string | null;
  createdAt: string;
}
