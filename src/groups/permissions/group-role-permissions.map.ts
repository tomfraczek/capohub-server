import { GroupRole } from '../enums/group-role.enum';
import { GroupPermission } from './group-permission.enum';

// Two separate maps, not one - a Role's permission set now depends on
// *what kind of target* it was granted on, not just the Role name. Group
// only ever grants OWNER/ADMIN (no membership, no ordinary members - see
// RoleAssignment's role-matches-target CHECK constraint), so
// GROUP_TARGET_ROLE_PERMISSIONS deliberately excludes every
// membership-lifecycle permission (MEMBERSHIP_*, GROUP_INVITE,
// GROUP_JOIN_REQUEST_REVIEW) - not because the route doesn't exist, but
// because a Group-context authorization check must never even have the
// chance to grant them. Section keeps the full, richer role set (all 5
// roles, every permission) under SECTION_TARGET_ROLE_PERMISSIONS.
//
// This is the single, deterministic source of truth for (target kind,
// Role) -> Permission. GroupPermissionsGuard (and anything else checking
// authorization) must go through GroupPermissionService, never compare
// Role names directly.

const SECTION_MEMBER_PERMISSIONS: readonly GroupPermission[] = [
  GroupPermission.GROUP_VIEW,
  GroupPermission.MEMBERSHIP_VIEW,
  GroupPermission.ACADEMY_VIEW,
  GroupPermission.COHORT_VIEW,
  GroupPermission.SECTION_VIEW,
  GroupPermission.RECIPIENT_GROUP_VIEW,
  GroupPermission.ANNOUNCEMENT_VIEW,
  // GROUP_INVITE is intentionally included here even though service-layer
  // logic additionally gates it on Section.memberInvitesAllowed. This
  // allows the guard to let MEMBER requests through to the service; the
  // service then rejects them when the setting is off. ADMIN and OWNER
  // always pass regardless of the setting.
  GroupPermission.GROUP_INVITE,
  // Every member may browse this Section's own Trainings - actual
  // visibility of a MEMBERS_ONLY vs PUBLIC Training is resolved per-row by
  // TrainingsService, this permission only gates the endpoint itself (see
  // GroupPermission.TRAINING_VIEW's own comment).
  GroupPermission.TRAINING_VIEW,
];

// ASSISTANT has no extra permissions yet - it carries no functional weight
// until a later stage (see GroupRole's own comment).
const SECTION_ASSISTANT_PERMISSIONS: readonly GroupPermission[] = [
  ...SECTION_MEMBER_PERMISSIONS,
];

// INSTRUCTOR's one functional permission tier: full Training/TrainingSeries
// authoring plus attendance-taking and plan/notes access for every Training
// in this Section (see the module spec §4) - it still gains none of
// ADMIN's membership/catalog/event management.
const SECTION_INSTRUCTOR_PERMISSIONS: readonly GroupPermission[] = [
  ...SECTION_MEMBER_PERMISSIONS,
  GroupPermission.TRAINING_MANAGE,
  GroupPermission.TRAINING_ATTENDANCE_MANAGE,
  GroupPermission.TRAINING_PRIVATE_NOTES_MANAGE,
];

const SECTION_ADMIN_PERMISSIONS: readonly GroupPermission[] = [
  ...SECTION_MEMBER_PERMISSIONS,
  GroupPermission.GROUP_EDIT,
  GroupPermission.GROUP_SETTINGS_MANAGE,
  GroupPermission.AUDIT_LOG_VIEW,
  GroupPermission.MEMBERSHIP_ADD,
  GroupPermission.MEMBERSHIP_ROLE_CHANGE,
  GroupPermission.MEMBERSHIP_REMOVE,
  GroupPermission.MEMBERSHIP_COHORT_ASSIGN,
  GroupPermission.MEMBERSHIP_INVITE,
  GroupPermission.MEMBERSHIP_REQUEST_REVIEW,
  GroupPermission.GROUP_JOIN_REQUEST_REVIEW,
  // Ban/Unban and Suspend/Unsuspend sit at the same trust tier as
  // MEMBERSHIP_REMOVE/MEMBERSHIP_ROLE_CHANGE - an ADMIN already has full
  // member-management authority; these are additional member-management
  // actions, not a stronger trust tier.
  GroupPermission.MEMBERSHIP_BAN,
  GroupPermission.MEMBERSHIP_UNBAN,
  GroupPermission.MEMBERSHIP_SUSPEND,
  GroupPermission.MEMBERSHIP_UNSUSPEND,
  GroupPermission.ACADEMY_CREATE,
  GroupPermission.ACADEMY_EDIT,
  GroupPermission.ACADEMY_ARCHIVE,
  GroupPermission.COHORT_CREATE,
  GroupPermission.COHORT_EDIT,
  GroupPermission.COHORT_ARCHIVE,
  GroupPermission.SECTION_CREATE,
  // Creating an Event, and the oversight/override tier over every Event in
  // this community - see the Event enum values' own comments.
  GroupPermission.EVENT_CREATE,
  GroupPermission.EVENT_VIEW_ALL,
  GroupPermission.EVENT_MODERATE,
  GroupPermission.RECIPIENT_GROUP_MANAGE,
  GroupPermission.ANNOUNCEMENT_MANAGE,
  GroupPermission.ANNOUNCEMENT_ARCHIVE_VIEW,
  // Formal rank correction workflow - ADMIN may request/view freely, and
  // may review (approve/reject), but only its own reports (see
  // GroupPermission.FORMAL_RANK_CORRECTION_REVIEW's own comment - the
  // reportedBy-must-match-actor restriction is enforced in
  // FormalRankCorrectionService, not expressible here).
  GroupPermission.FORMAL_RANK_CORRECTION_REQUEST,
  GroupPermission.FORMAL_RANK_CORRECTION_REVIEW,
  GroupPermission.FORMAL_RANK_CORRECTION_VIEW,
  // ADMIN gets every INSTRUCTOR Training capability plus the OWNER/ADMIN-only
  // statistics endpoint (see GroupPermission.TRAINING_STATS_VIEW's own
  // comment - deliberately withheld from INSTRUCTOR).
  GroupPermission.TRAINING_MANAGE,
  GroupPermission.TRAINING_ATTENDANCE_MANAGE,
  GroupPermission.TRAINING_PRIVATE_NOTES_MANAGE,
  GroupPermission.TRAINING_STATS_VIEW,
];

// Every lifecycle-status permission (ARCHIVE, UNARCHIVE, SET_READ_ONLY,
// ACTIVATE, DELETE) plus OWNERSHIP_TRANSFER is deliberately withheld from
// ADMIN and reserved for OWNER. DELETE is grouped with these since it is a
// lifecycle action, and the most severe/irreversible one.
const SECTION_OWNER_PERMISSIONS: readonly GroupPermission[] = [
  ...SECTION_ADMIN_PERMISSIONS,
  GroupPermission.GROUP_ARCHIVE,
  GroupPermission.GROUP_UNARCHIVE,
  GroupPermission.GROUP_SET_READ_ONLY,
  GroupPermission.GROUP_ACTIVATE,
  GroupPermission.GROUP_DELETE,
  GroupPermission.GROUP_OWNERSHIP_TRANSFER,
  // A Section can be a hierarchy child (never a parent - see
  // HIERARCHY_INVITE's own comment) - only its OWNER may attach/move/detach
  // it under a parent Group, or accept/reject an invitation proposing that
  // on its behalf.
  GroupPermission.HIERARCHY_MANAGE,
];

export const SECTION_TARGET_ROLE_PERMISSIONS: Readonly<
  Record<GroupRole, readonly GroupPermission[]>
> = {
  [GroupRole.MEMBER]: SECTION_MEMBER_PERMISSIONS,
  [GroupRole.ASSISTANT]: SECTION_ASSISTANT_PERMISSIONS,
  [GroupRole.INSTRUCTOR]: SECTION_INSTRUCTOR_PERMISSIONS,
  [GroupRole.ADMIN]: SECTION_ADMIN_PERMISSIONS,
  [GroupRole.OWNER]: SECTION_OWNER_PERMISSIONS,
};

// Group never has ordinary members - only OWNER/ADMIN administer it. Every
// membership-lifecycle permission (MEMBERSHIP_*, GROUP_INVITE,
// GROUP_JOIN_REQUEST_REVIEW) is deliberately absent: there is no route
// that could ever request them for a Group target (see groups.controller.ts
// - member/join/leave/ban/suspend routes only exist on SectionController),
// but keeping the map itself free of them means a coding mistake can't
// accidentally grant them either.
const GROUP_ADMIN_PERMISSIONS: readonly GroupPermission[] = [
  GroupPermission.GROUP_VIEW,
  GroupPermission.GROUP_EDIT,
  GroupPermission.GROUP_SETTINGS_MANAGE,
  GroupPermission.AUDIT_LOG_VIEW,
  GroupPermission.ACADEMY_VIEW,
  GroupPermission.ACADEMY_CREATE,
  GroupPermission.ACADEMY_EDIT,
  GroupPermission.ACADEMY_ARCHIVE,
  GroupPermission.COHORT_VIEW,
  GroupPermission.COHORT_CREATE,
  GroupPermission.COHORT_EDIT,
  GroupPermission.COHORT_ARCHIVE,
  GroupPermission.SECTION_VIEW,
  GroupPermission.SECTION_CREATE,
  GroupPermission.EVENT_CREATE,
  GroupPermission.EVENT_VIEW_ALL,
  GroupPermission.EVENT_MODERATE,
  GroupPermission.RECIPIENT_GROUP_VIEW,
  GroupPermission.RECIPIENT_GROUP_MANAGE,
  GroupPermission.ANNOUNCEMENT_VIEW,
  GroupPermission.ANNOUNCEMENT_MANAGE,
  GroupPermission.ANNOUNCEMENT_ARCHIVE_VIEW,
  // Graduation catalog - OWNER and ADMIN of this exact Group manage it
  // equally (see GroupPermission.GRADUATION_SYSTEM_MANAGE's own comment),
  // so both permissions sit directly on the ADMIN tier rather than being
  // split/escalated to OWNER_PERMISSIONS the way lifecycle actions are.
  GroupPermission.GRADUATION_SYSTEM_VIEW,
  GroupPermission.GRADUATION_SYSTEM_MANAGE,
  // Propose attaching a child Group/Section this ADMIN does not directly
  // control - the recipient's own OWNER still has to accept (see
  // HierarchyInvitation), so this never mutates anything by itself and can
  // safely sit at the same tier as GROUP_INVITE/MEMBERSHIP_INVITE. Only a
  // Group may be the parent side of a hierarchy relationship, so this is
  // deliberately absent from SECTION_ADMIN_PERMISSIONS above.
  GroupPermission.HIERARCHY_INVITE,
];

const GROUP_OWNER_PERMISSIONS: readonly GroupPermission[] = [
  ...GROUP_ADMIN_PERMISSIONS,
  GroupPermission.GROUP_ARCHIVE,
  GroupPermission.GROUP_UNARCHIVE,
  GroupPermission.GROUP_SET_READ_ONLY,
  GroupPermission.GROUP_ACTIVATE,
  GroupPermission.GROUP_DELETE,
  GroupPermission.GROUP_OWNERSHIP_TRANSFER,
  // A Group can be both a hierarchy parent and a hierarchy child - only its
  // OWNER may attach/move/detach it under another Group, attach/detach its
  // own children directly, or accept/reject an invitation targeting it.
  GroupPermission.HIERARCHY_MANAGE,
];

// MEMBER/INSTRUCTOR/ASSISTANT map to an empty set here - defense in depth
// alongside the DB CHECK constraint (role_assignments_role_matches_target_check)
// and DTO-level validation (assignable-group-role.schema.ts): even if one
// of those were ever bypassed, a Group-target authorization check for one
// of these roles grants nothing.
export const GROUP_TARGET_ROLE_PERMISSIONS: Readonly<
  Record<GroupRole, readonly GroupPermission[]>
> = {
  [GroupRole.MEMBER]: [],
  [GroupRole.ASSISTANT]: [],
  [GroupRole.INSTRUCTOR]: [],
  [GroupRole.ADMIN]: GROUP_ADMIN_PERMISSIONS,
  [GroupRole.OWNER]: GROUP_OWNER_PERMISSIONS,
};

// Subset of GroupPermission that remains available while a SectionMembership
// is READ_ONLY. Every other permission requires the membership to be
// ACTIVE. Kept as an explicit allow-list, not a naming-convention check
// (e.g. "ends with _VIEW"), so adding a new permission can never
// accidentally become READ_ONLY-safe by naming coincidence. Group has no
// membership/READ_ONLY concept at all, so this list only ever applies to
// Section-target checks.
export const READ_ONLY_SAFE_PERMISSIONS: ReadonlySet<GroupPermission> = new Set(
  [
    GroupPermission.GROUP_VIEW,
    GroupPermission.MEMBERSHIP_VIEW,
    GroupPermission.ACADEMY_VIEW,
    GroupPermission.COHORT_VIEW,
    GroupPermission.SECTION_VIEW,
    GroupPermission.RECIPIENT_GROUP_VIEW,
    GroupPermission.ANNOUNCEMENT_VIEW,
    // Reading history poses no operational risk and matches "remains
    // visible" for READ_ONLY - deliberately added here explicitly, not
    // because of its "_VIEW" name.
    GroupPermission.AUDIT_LOG_VIEW,
    GroupPermission.FORMAL_RANK_CORRECTION_VIEW,
    GroupPermission.TRAINING_VIEW,
  ],
);

// The permissions a caller with NO RoleAssignment/SectionMembership at all
// may still be granted for a Group or Section, and only when it is
// `isPublic` - see RoleAssignmentsService.resolvePublicView, which this
// set gates: GroupPermissionsGuard only takes the Public-view fallback
// when every permission a route requires is in here. Deliberately narrow,
// not the wider READ_ONLY_SAFE_PERMISSIONS above - a stranger who has
// never joined must never see this community's member list, audit log,
// announcements, etc., only enough to decide whether to join it (module:
// Discover Community - "joining happens from the destination screen"):
//  - GROUP_VIEW: this Group/Section's own profile fields.
//  - SECTION_VIEW: a Group's list of child Sections (GET
//    /groups/:id/sections) - SectionsService.list() itself additionally
//    narrows that list to `isPublic` Sections for exactly this
//    unauthenticated-membership case, so a private child Section never
//    leaks through the list even though this permission lets the route
//    itself respond.
export const PUBLIC_VIEW_SAFE_PERMISSIONS: ReadonlySet<GroupPermission> =
  new Set([GroupPermission.GROUP_VIEW, GroupPermission.SECTION_VIEW]);
