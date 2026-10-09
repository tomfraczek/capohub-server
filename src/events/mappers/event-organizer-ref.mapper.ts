import {
  PublicUrlBuilder,
  resolveImageUrl,
  resolveUserAvatarUrl,
} from '../../storage/image-url.util';
import { Section } from '../../groups/entities/section.entity';
import { Event } from '../entities/event.entity';
import { eventCommunity } from '../event-community.util';
import { EventOrganizerType } from '../enums/event-organizer-type.enum';
import { EventOrganizerRefDto } from '../dto/event-organizer-ref.dto';
import { resolveDisplayName } from '../../users/display-name.util';

// Builds the single public organizer identity for `event` - requires
// `organizerUser`/`communityGroup`/`communitySection` to already be
// populated (see EventAccessService.loadOrFail's default populate list).
export function toEventOrganizerRefDto(
  event: Event,
  urlBuilder: PublicUrlBuilder,
): EventOrganizerRefDto {
  if (event.organizerType === EventOrganizerType.USER) {
    if (event.organizerUser) {
      const user = event.organizerUser;
      return {
        type: 'USER',
        id: user.id,
        name: resolveDisplayName(user),
        image: {
          type: user.avatarType,
          // Prefers the R2 public URL derived from avatarImageKey over the
          // legacy avatarUrl column once an UPLOAD avatar exists - see
          // storage/image-url.util.ts's resolveUserAvatarUrl.
          url: resolveUserAvatarUrl(user, urlBuilder),
          presetAvatarId: user.presetAvatarId,
        },
      };
    }
    // Historical organizer - the User account no longer exists
    // (organizerUser is ON DELETE SET NULL, see event.entity.ts). Falls
    // back to the display-name snapshot taken at creation
    // (organizerUserDisplayName is required non-null for organizerType ===
    // USER by events_organizer_identity_check) - never re-derives a live
    // profile for an id that no longer resolves to anything, and never
    // fabricates an image for it (see that field's own comment).
    return {
      type: 'USER',
      id: null,
      name: event.organizerUserDisplayName!,
      image: null,
    };
  }

  // organizerType is GROUP/SECTION here, so - per
  // events_organizer_identity_check (see event.entity.ts) - exactly one of
  // communityGroup/communitySection must be set, meaning
  // eventCommunity(event) is guaranteed non-null.
  const community = eventCommunity(event)!;
  return {
    type: community instanceof Section ? 'SECTION' : 'GROUP',
    id: community.id,
    name: community.name,
    // Prefers the R2 public URL derived from profileImageKey over the
    // legacy logoUrl column once an upload exists - see
    // storage/image-url.util.ts's resolveImageUrl.
    image: {
      url: resolveImageUrl(
        community.profileImageKey,
        community.logoUrl,
        urlBuilder,
      ),
    },
  };
}
