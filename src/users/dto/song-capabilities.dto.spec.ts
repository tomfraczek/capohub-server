import { GlobalRole } from '../../auth/permissions/global-role.enum';
import { PermissionService } from '../../auth/permissions/permission.service';
import { buildSongCapabilities } from './song-capabilities.dto';

// Exercises the real ROLE_PERMISSIONS map (via a real PermissionService,
// never mocked) - the point of this spec is to prove songCapabilities
// reflects the actual permission system, not a hand-picked expectation
// per role. If a future change to role-permissions.map.ts shifts one of
// these, this spec must fail and be updated deliberately - it must never
// be "fixed" by hardcoding a role check in song-capabilities.dto.ts.
describe('buildSongCapabilities', () => {
  const permissionService = new PermissionService();

  it('USER: none of the four (only SONG_READ)', () => {
    expect(buildSongCapabilities(GlobalRole.USER, permissionService)).toEqual({
      canCreate: false,
      canApproveContent: false,
      canHideContent: false,
      canDeleteAnyDraft: false,
    });
  });

  it('EDITOR: canCreate only (SONG_CREATE, no moderation/deletion permissions)', () => {
    expect(buildSongCapabilities(GlobalRole.EDITOR, permissionService)).toEqual(
      {
        canCreate: true,
        canApproveContent: false,
        canHideContent: false,
        canDeleteAnyDraft: false,
      },
    );
  });

  it('MODERATOR: canCreate + canApproveContent + canHideContent, not canDeleteAnyDraft (no SONG_DELETE)', () => {
    expect(
      buildSongCapabilities(GlobalRole.MODERATOR, permissionService),
    ).toEqual({
      canCreate: true,
      canApproveContent: true,
      canHideContent: true,
      canDeleteAnyDraft: false,
    });
  });

  it('ADMIN: all four (adds SONG_DELETE on top of MODERATOR)', () => {
    expect(buildSongCapabilities(GlobalRole.ADMIN, permissionService)).toEqual({
      canCreate: true,
      canApproveContent: true,
      canHideContent: true,
      canDeleteAnyDraft: true,
    });
  });

  it('SUPER_ADMIN: all four (holds every Permission that exists)', () => {
    expect(
      buildSongCapabilities(GlobalRole.SUPER_ADMIN, permissionService),
    ).toEqual({
      canCreate: true,
      canApproveContent: true,
      canHideContent: true,
      canDeleteAnyDraft: true,
    });
  });
});
