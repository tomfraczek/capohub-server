export interface PlaylistSummaryResponseDto {
  id: string;
  name: string;
  description: string | null;
  songCount: number;
  createdAt: string;
  updatedAt: string;
}
