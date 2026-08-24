import { AvatarType } from '../users/enums/avatar-type.enum';
import { User } from '../users/entities/user.entity';

// Narrow interface (structurally satisfied by R2StorageService) rather than
// depending on the concrete class - lets every mapper below stay a plain,
// pure function in unit tests without constructing a real R2StorageService
// (see mapper spec files, which pass a trivial `{ buildPublicUrl: (k) =>
// ... }` object instead).
export interface PublicUrlBuilder {
  buildPublicUrl(objectKey: string): string;
}

/**
 * The one rule behind every "new R2 key vs. legacy URL column" field this
 * module introduced (Group/Section profileImageKey vs. legacy logoUrl,
 * Event coverImageKey vs. legacy coverImageUrl - module spec §12/§29): the
 * key, when present, always wins - never both, never "prefer whichever is
 * non-null in DB order". Once a resource has an R2-backed image, the
 * legacy column is cleared at write time (see the various *.service.ts
 * upload/delete methods), so falling back to `legacyUrl` here only ever
 * matters for a resource that has never used the new upload endpoint at
 * all.
 */
export function resolveImageUrl(
  imageKey: string | null,
  legacyUrl: string | null,
  urlBuilder: PublicUrlBuilder,
): string | null {
  return imageKey ? urlBuilder.buildPublicUrl(imageKey) : legacyUrl;
}

/**
 * Same rule as resolveImageUrl above, specialized for User.avatarUrl -
 * only relevant while avatarType is UPLOAD (module spec §23): a CLERK or
 * PRESET avatar has no R2 object at all (avatarImageKey is always null for
 * either - see user.entity.ts), so this always falls through to the plain
 * `user.avatarUrl` field for those two, exactly as before this module.
 */
export function resolveUserAvatarUrl(
  user: User,
  urlBuilder: PublicUrlBuilder,
): string | null {
  if (user.avatarType === AvatarType.UPLOAD && user.avatarImageKey) {
    return urlBuilder.buildPublicUrl(user.avatarImageKey);
  }
  return user.avatarUrl;
}
