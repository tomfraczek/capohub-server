// Minimal reference for the "add member" picker behind
// GET .../recipient-groups/eligible-members - deliberately its own shape,
// not GroupUserRefDto (which every other Recipient Group/Announcement
// response already uses for `members`/`author`): that type has no
// `avatarUrl`, and adding one there would silently change every one of
// those unrelated response bodies too. Never carries email or any other
// profile field the picker doesn't need.
export interface RecipientGroupEligibleMemberDto {
  id: string;
  displayName: string;
  avatarUrl: string | null;
}

// Same items/total/hasMore shape as AnnouncementListResult - `total`/
// `hasMore` always describe the full matching set, not just this page.
export interface RecipientGroupEligibleMembersResponseDto {
  items: RecipientGroupEligibleMemberDto[];
  total: number;
  hasMore: boolean;
}
