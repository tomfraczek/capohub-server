import { GlobalRole } from '../../auth/permissions/global-role.enum';
import { Permission } from '../../auth/permissions/permission.enum';
import { PermissionService } from '../../auth/permissions/permission.service';

// Global, user-scoped capabilities for the Songs module, computed
// server-side from the caller's GlobalRole via PermissionService - the
// frontend must never map globalRole -> permissions itself (that mapping
// lives only in role-permissions.map.ts). One permission, one capability:
// canApproveContent alone gates both the Song publish/reject flow
// (SongsController.publish/reject) and SongEditProposal review
// (SongEditProposalsController.approve/reject/list/getById) - both are
// CONTENT_APPROVE under the hood, so they are not duplicated into two
// booleans here.
//
// Deliberately excludes anything row-level - is this draft mine, can I
// edit/delete this specific Song, did I create this proposal, can I review
// my own proposal. Those questions can only be answered once a specific
// Song/SongEditProposal is loaded, and remain the responsibility of the
// Songs/SongEditProposals endpoints themselves (ownership checks,
// self-review safeguard) - a global capability set must never encode them.
//
// Also deliberately excludes a "canProposeEdit" flag: POST
// /songs/:songId/edit-proposals has no @Permissions() guard at all (see
// SongEditProposalsController.create) - every authenticated user can
// propose a change to a PUBLISHED/HIDDEN Song, so a capability that is
// always true would carry no information and must not be added here. The
// frontend derives that ability from being signed in plus the target
// Song's status, not from this DTO.
export interface SongCapabilitiesDto {
  canCreate: boolean;
  canApproveContent: boolean;
  canHideContent: boolean;
  canDeleteAnyDraft: boolean;
}

export function buildSongCapabilities(
  role: GlobalRole,
  permissionService: PermissionService,
): SongCapabilitiesDto {
  return {
    canCreate: permissionService.hasPermission(role, Permission.SONG_CREATE),
    canApproveContent: permissionService.hasPermission(
      role,
      Permission.CONTENT_APPROVE,
    ),
    canHideContent: permissionService.hasPermission(
      role,
      Permission.CONTENT_HIDE,
    ),
    canDeleteAnyDraft: permissionService.hasPermission(
      role,
      Permission.SONG_DELETE,
    ),
  };
}
