// Who besides a community's own admins/staff may see one of its people
// lists - same PUBLIC/PRIVATE shape as EventParticipantsVisibility:
//  - Group.followersVisibility gates GET /groups/:id/followers (Section
//    members + followers): PUBLIC = also every member of its direct
//    Sections and every follower; PRIVATE = Group OWNER/ADMIN only.
//  - Section.membersVisibility gates GET /sections/:id/members(/:id):
//    PUBLIC = every member (the original behavior); PRIVATE = the
//    Section's staff only (OWNER/ADMIN/INSTRUCTOR - see
//    section-members-visibility.ts).
export enum CommunityListVisibility {
  PUBLIC = 'PUBLIC',
  PRIVATE = 'PRIVATE',
}
