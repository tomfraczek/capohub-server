// Group-scoped capability permissions, checked against a user's Role
// Assignment for the exact Group being acted on (see
// group-role-permissions.map.ts and GroupPermissionsGuard) - not against
// GlobalRole/Permission (auth/permissions/permission.enum.ts), which stays a
// fully separate, site-wide system. Endpoints are authorized against these,
// never against GroupRole directly (mirrors the Permission/GlobalRole
// split).
//
// Deliberately one enum per existing domain only (Group, Membership,
// Academy, Cohort) - no permissions for domains that don't exist yet
// (Graduation, Invitations, Visibility Scope, ...). Role Assignment
// management has its own ROLE_ASSIGNMENT_VIEW/ROLE_ASSIGNMENT_MANAGE pair -
// see their own comment below.
export enum GroupPermission {
  // Group
  GROUP_VIEW = 'GROUP_VIEW',
  GROUP_EDIT = 'GROUP_EDIT',
  GROUP_ARCHIVE = 'GROUP_ARCHIVE',
  // Deliberately separate from GROUP_ARCHIVE, not reused for both
  // directions - archiving and restoring are distinct capabilities that
  // happen to both be OWNER-only today (see group-role-permissions.map.ts).
  GROUP_UNARCHIVE = 'GROUP_UNARCHIVE',
  // Same split as ARCHIVE/UNARCHIVE, one step down the lifecycle: setting
  // READ_ONLY and reactivating from it are separate capabilities.
  GROUP_SET_READ_ONLY = 'GROUP_SET_READ_ONLY',
  GROUP_ACTIVATE = 'GROUP_ACTIVATE',
  GROUP_OWNERSHIP_TRANSFER = 'GROUP_OWNERSHIP_TRANSFER',
  // Permanent, irreversible removal (see ADR-029) - deliberately its own
  // permission, not reused from GROUP_ARCHIVE, since Delete is a strictly
  // more severe, non-undoable action than Archive.
  GROUP_DELETE = 'GROUP_DELETE',
  // Group-level discovery/join settings (isPublic, isHidden, memberInvitesAllowed).
  // Separate from GROUP_EDIT so ownership-sensitive settings can be guarded
  // more tightly without touching the main edit permission.
  GROUP_SETTINGS_MANAGE = 'GROUP_SETTINGS_MANAGE',
  // Read access to this Group's Audit Log (see AuditLogEntry). Separate
  // from GROUP_VIEW so audit history - which can reveal moderation actions
  // like bans/suspensions - is not automatically visible to every viewer.
  AUDIT_LOG_VIEW = 'AUDIT_LOG_VIEW',
  //
  // Note: Community Notification settings (see
  // CommunityNotificationSettings) deliberately have NO corresponding
  // GroupPermission/guard - see CommunityNotificationSettingsService's own
  // comment for why: every Membership manages its own row, including the
  // valid zero-Role-Assignment case that GroupPermissionsGuard cannot
  // authorize at all.

  // Role Assignment (RoleAssignmentsController - grant/revoke/list a
  // Group's or Section's Roles). Deliberately its own pair rather than
  // GROUP_VIEW/GROUP_EDIT:
  //  - Group: OWNER and ADMIN may list and grant/revoke ADMIN; nobody
  //    without a Role there sees the list at all (GROUP_VIEW is
  //    public-view-safe, so it could not express that). OWNER is never
  //    grantable/revocable through these routes, whoever the caller is.
  //  - Section: unchanged from the GROUP_VIEW/GROUP_EDIT tiers it replaces -
  //    every member may view, ADMIN and OWNER may manage.
  ROLE_ASSIGNMENT_VIEW = 'ROLE_ASSIGNMENT_VIEW',
  ROLE_ASSIGNMENT_MANAGE = 'ROLE_ASSIGNMENT_MANAGE',

  // Membership (always Root Group-scoped - see organization-entities.md#membership)
  MEMBERSHIP_VIEW = 'MEMBERSHIP_VIEW',
  MEMBERSHIP_ADD = 'MEMBERSHIP_ADD',
  MEMBERSHIP_ROLE_CHANGE = 'MEMBERSHIP_ROLE_CHANGE',
  MEMBERSHIP_REMOVE = 'MEMBERSHIP_REMOVE',
  MEMBERSHIP_COHORT_ASSIGN = 'MEMBERSHIP_COHORT_ASSIGN',
  // Ends the Membership (like MEMBERSHIP_REMOVE) and additionally blocks the
  // user from rejoining or being re-invited until unbanned - see GroupBan.
  MEMBERSHIP_BAN = 'MEMBERSHIP_BAN',
  MEMBERSHIP_UNBAN = 'MEMBERSHIP_UNBAN',
  // Sets/lifts a Membership's READ_ONLY status for a bounded (or
  // indefinite) time window - see MembershipSuspension. Deliberately
  // distinct from MEMBERSHIP_ROLE_CHANGE/MEMBERSHIP_REMOVE: suspension
  // touches Membership.status, never a Role Assignment, and does not end
  // the Membership the way Ban/Remove do.
  MEMBERSHIP_SUSPEND = 'MEMBERSHIP_SUSPEND',
  MEMBERSHIP_UNSUSPEND = 'MEMBERSHIP_UNSUSPEND',
  // Group-level invitation and join-request management.
  // These are checked on the Root Group and act on Membership (not on a
  // specific Group's MEMBER role).  OWNER Group does NOT receive
  // these in any Child Group - authorization is always per-group and
  // never inherited (see ADR-013, ADR-024).
  MEMBERSHIP_INVITE = 'MEMBERSHIP_INVITE',
  MEMBERSHIP_REQUEST_REVIEW = 'MEMBERSHIP_REQUEST_REVIEW',

  // Group-level invitation and join-request management.
  // Checked on the exact Group being invited into / whose join requests
  // are being reviewed.  MEMBER can only invite when
  // Group.memberInvitesAllowed is true (enforced at the service layer, not
  // by the guard - see MembershipRequestsService).
  GROUP_INVITE = 'GROUP_INVITE',
  GROUP_JOIN_REQUEST_REVIEW = 'GROUP_JOIN_REQUEST_REVIEW',

  // Academy
  ACADEMY_VIEW = 'ACADEMY_VIEW',
  ACADEMY_CREATE = 'ACADEMY_CREATE',
  ACADEMY_EDIT = 'ACADEMY_EDIT',
  ACADEMY_ARCHIVE = 'ACADEMY_ARCHIVE',

  // Cohort
  COHORT_VIEW = 'COHORT_VIEW',
  COHORT_CREATE = 'COHORT_CREATE',
  COHORT_EDIT = 'COHORT_EDIT',
  COHORT_ARCHIVE = 'COHORT_ARCHIVE',

  // Section (a non-root Group, i.e. a child in the hierarchy - see the
  // Group/Section rename ADR). Unlike Academy/Cohort, a Section is not a
  // plain property of its owning Group - it is itself a Group row with its
  // own lifecycle and ownership. So only the "sub-resource of a parent"
  // half of the Academy/Cohort pattern applies here: SECTION_CREATE/VIEW
  // gate creating/listing Sections directly under a Group or another
  // Section (checked against the *parent*). Once a Section is addressed
  // directly (/sections/:sectionId/...), it is checked with the same
  // level-agnostic GROUP_VIEW/GROUP_EDIT/GROUP_ARCHIVE/... permissions used
  // for a root Group - there is no separate SECTION_EDIT/SECTION_ARCHIVE,
  // mirroring RoleAssignmentsController's "same administrative capability
  // regardless of whether the Group is a Root or a Child" precedent.
  SECTION_VIEW = 'SECTION_VIEW',
  SECTION_CREATE = 'SECTION_CREATE',

  // Event - community-level gate only. Administering one *specific* Event
  // once it exists (edit/publish/cancel/organizers/moderators/check-in/...)
  // is deliberately NOT here - it is answered by the Event's own
  // Owner/Organizer/Moderator tier instead (see
  // events/permissions/event-permission.enum.ts), kept independent of
  // Community roles per the Events spec ("Oddziel role administracyjne
  // Eventu od ról Community"). Viewing one specific Event's detail is also
  // not here - that is gated by the Event's own `visibility` field,
  // resolved in EventsService against the caller's Community membership /
  // invitations, never by a fixed Role-based permission.
  EVENT_CREATE = 'EVENT_CREATE',
  // Oversight only: list/view every Event under this community, including
  // Drafts and Invite-Only ones the caller holds no Event role for. Grants
  // no write access - see EVENT_MODERATE.
  EVENT_VIEW_ALL = 'EVENT_VIEW_ALL',
  // Narrow emergency-moderation override: cancel any Event under this
  // community even without holding any Event role there. Grants no
  // edit/publish/organizer-management rights - those stay exclusively
  // Event-role-gated. Not requested explicitly by the product spec; added
  // so a community is never held hostage by an unresponsive/departed Event
  // Owner - see docs/api/events-api.md "Architectural decisions".
  EVENT_MODERATE = 'EVENT_MODERATE',

  // Recipient Group - a manually-managed, named subset of this community's
  // members used to target Announcements (see RecipientGroup). One
  // combined _MANAGE permission (create, rename, change members, activate,
  // deactivate) rather than Academy/Cohort's separate CREATE/EDIT/ARCHIVE
  // split - unlike Group's lifecycle, every one of these actions sits at
  // the exact same OWNER-and-ADMIN trust tier, so splitting them would add
  // permissions without expressing any real distinction.
  RECIPIENT_GROUP_VIEW = 'RECIPIENT_GROUP_VIEW',
  RECIPIENT_GROUP_MANAGE = 'RECIPIENT_GROUP_MANAGE',

  // Announcement - an official, no-comments/no-reactions community
  // message (see Announcement). ANNOUNCEMENT_VIEW gates the active list/
  // detail endpoints only; a further, recipient-specific visibility check
  // (Group/Section membership, or Recipient Group snapshot membership -
  // see AnnouncementsService) narrows *which* Announcements a member with
  // this permission actually sees, same split as EVENT_CREATE vs Event's
  // own visibility rule. ANNOUNCEMENT_ARCHIVE_VIEW is deliberately its own
  // permission, not folded into _MANAGE: every Owner/Admin action here
  // happens to sit at the same trust tier, but "read the expired-Announcement
  // archive" is a distinct capability from "create/edit/pin/delete", mirroring
  // AUDIT_LOG_VIEW's own separation from GROUP_EDIT above.
  ANNOUNCEMENT_VIEW = 'ANNOUNCEMENT_VIEW',
  ANNOUNCEMENT_MANAGE = 'ANNOUNCEMENT_MANAGE',
  ANNOUNCEMENT_ARCHIVE_VIEW = 'ANNOUNCEMENT_ARCHIVE_VIEW',

  // Hierarchy - attaching/detaching/moving a whole Group or Section in or
  // out of a parent Group (see HierarchyInvitation and
  // GroupHierarchyService). HIERARCHY_MANAGE gates the structural mutation
  // itself (direct attach/detach/move, and accepting/rejecting an
  // invitation on the target side) - deliberately the same OWNER-only trust
  // tier as GROUP_OWNERSHIP_TRANSFER, not ADMIN like GROUP_EDIT: moving an
  // entire community's position in the organization is a stewardship
  // decision, not an ordinary edit. HIERARCHY_INVITE is the lower-risk
  // half - proposing a relationship the other side must still accept never
  // mutates anything by itself, so it sits at the same ADMIN+OWNER tier as
  // GROUP_INVITE/MEMBERSHIP_INVITE, and only ever applies on the parent
  // side (only a Group can have children). There is deliberately no
  // HIERARCHY_VIEW - reading a community's parent/children/breadcrumbs is
  // answered by the GROUP_VIEW every role already holds.
  HIERARCHY_MANAGE = 'HIERARCHY_MANAGE',
  HIERARCHY_INVITE = 'HIERARCHY_INVITE',

  // Graduation catalog (GraduationSystem/Rank - see graduation/entities) -
  // exact-Group-only, deliberately absent from
  // SECTION_TARGET_ROLE_PERMISSIONS: a Section never defines its own
  // catalog, and Section OWNER/ADMIN gain no catalog rights through
  // membership or hierarchy (see the module spec). One combined _MANAGE
  // permission covers every mutation (create/edit system, create/edit/
  // reorder/archive/restore Rank) - unlike Academy/Cohort, every one of
  // these actions sits at the exact same OWNER-and-ADMIN trust tier per
  // the spec, so splitting them would add permissions without expressing
  // any real distinction (same reasoning as RECIPIENT_GROUP_MANAGE).
  GRADUATION_SYSTEM_VIEW = 'GRADUATION_SYSTEM_VIEW',
  GRADUATION_SYSTEM_MANAGE = 'GRADUATION_SYSTEM_MANAGE',
  // Confirm/reject a member's declared rank in this Group's graduation
  // system (FormalRankRequest - "Prośby o potwierdzenie stopnia").
  // Exact-Group-only, OWNER and ADMIN alike - deliberately its own
  // permission rather than GRADUATION_SYSTEM_MANAGE: deciding *who holds*
  // a rank is a different capability from editing the catalog, even if
  // both sit at the same trust tier today. Not FORMAL_RANK_CORRECTION_* -
  // those are Section-scoped and correct an existing assignment.
  FORMAL_RANK_REQUEST_REVIEW = 'FORMAL_RANK_REQUEST_REVIEW',

  // Read-only list of the people tied to a Group - members of its direct
  // Sections plus its GroupFollow followers (see GroupAudienceService).
  // Group-only (a Section has its own MEMBERSHIP_VIEW members list),
  // OWNER and ADMIN alike.
  GROUP_FOLLOWERS_VIEW = 'GROUP_FOLLOWERS_VIEW',
  // Remove a follower and block/unblock following (GroupFollowBlock) -
  // Group-only, OWNER and ADMIN alike. Section members are managed with
  // the Section's own MEMBERSHIP_REMOVE/MEMBERSHIP_BAN, never this.
  GROUP_FOLLOWERS_MANAGE = 'GROUP_FOLLOWERS_MANAGE',

  // Formal rank correction workflow (see FormalRankCorrectionRequest) -
  // exact-Section-only, deliberately absent from GROUP_TARGET_ROLE_PERMISSIONS:
  // a formal rank is corrected in the context of the exact Section the
  // target belongs to, never at the Group level, and never inherited
  // through the hierarchy (see the module spec). Not GRADUATION_SYSTEM_MANAGE
  // - that permission governs the *catalog* (Group-only); this one governs
  // *who currently holds which catalog Rank* (Section-only), a distinct
  // capability at a distinct scope. REQUEST/VIEW are granted identically to
  // OWNER and ADMIN; REVIEW is granted to both here too, but the finer
  // "ADMIN may only review their own report" rule (variant C) is a
  // row-level condition the permission-map system cannot express, so it is
  // enforced in FormalRankCorrectionService itself, not here.
  FORMAL_RANK_CORRECTION_REQUEST = 'FORMAL_RANK_CORRECTION_REQUEST',
  FORMAL_RANK_CORRECTION_REVIEW = 'FORMAL_RANK_CORRECTION_REVIEW',
  FORMAL_RANK_CORRECTION_VIEW = 'FORMAL_RANK_CORRECTION_VIEW',

  // Training (see trainings/entities/training.entity.ts) - exact-Section-only,
  // deliberately absent from GROUP_TARGET_ROLE_PERMISSIONS: a Training always
  // belongs to a specific Section, never to a Group or inherited through the
  // hierarchy (see the module spec). TRAINING_VIEW gates browsing this
  // Section's own training list/detail management surface - a MEMBERS_ONLY
  // Training's actual visibility to a given viewer is additionally resolved
  // per-Training (see TrainingsService), same split as EVENT_CREATE vs
  // Event's own visibility rule. TRAINING_MANAGE covers every
  // create/edit/cancel action on a Training or TrainingSeries.
  // TRAINING_ATTENDANCE_MANAGE and TRAINING_PRIVATE_NOTES_MANAGE are
  // deliberately their own permissions, not folded into TRAINING_MANAGE:
  // the assigned trainer of one specific Training also gets an equivalent,
  // narrower capability for that Training alone without holding any of
  // these Section-wide permissions (a resource-level override resolved in
  // TrainingsService/TrainingAttendanceService, not expressible in this
  // permission map - see the module spec §3). TRAINING_STATS_VIEW is
  // deliberately withheld from INSTRUCTOR (unlike the other three) and
  // reserved for OWNER/ADMIN, mirroring AUDIT_LOG_VIEW's own tier.
  TRAINING_VIEW = 'TRAINING_VIEW',
  TRAINING_MANAGE = 'TRAINING_MANAGE',
  TRAINING_ATTENDANCE_MANAGE = 'TRAINING_ATTENDANCE_MANAGE',
  TRAINING_PRIVATE_NOTES_MANAGE = 'TRAINING_PRIVATE_NOTES_MANAGE',
  TRAINING_STATS_VIEW = 'TRAINING_STATS_VIEW',

  // Metronome sequences shared in a Section (see
  // metronome-sequences/entities/section-metronome-sequence.entity.ts) -
  // exact-Section-only, absent from GROUP_TARGET_ROLE_PERMISSIONS like
  // Training. METRONOME_SEQUENCE_VIEW lets every member browse, play and copy
  // the Section's shared sequences to their own account;
  // METRONOME_SEQUENCE_SHARE (OWNER/ADMIN) shares one's own sequences into the
  // Section and removes any shared sequence from it. Never public-view-safe:
  // a non-member gets 404.
  METRONOME_SEQUENCE_VIEW = 'METRONOME_SEQUENCE_VIEW',
  METRONOME_SEQUENCE_SHARE = 'METRONOME_SEQUENCE_SHARE',
}
