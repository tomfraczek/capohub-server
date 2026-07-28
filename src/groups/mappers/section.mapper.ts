import { Group } from '../entities/group.entity';
import { SectionResponseDto } from '../dto/section-response.dto';

// `group` here is always non-root (SectionsService only ever loads/creates
// Group rows with a parentGroup - see the Group/Section rename ADR). The
// caller is responsible for that invariant; this mapper trusts it and
// throws if parentGroup is unexpectedly null, since a "Section" with no
// parent would be a Group in disguise and must never reach a response.
export function toSectionResponseDto(group: Group): SectionResponseDto {
  if (!group.parentGroup) {
    throw new Error('toSectionResponseDto called with a root Group');
  }
  return {
    id: group.id,
    parentId: group.parentGroup.id,
    name: group.name,
    description: group.description,
    logoUrl: group.logoUrl,
    coverImageUrl: group.coverImageUrl,
    contactEmail: group.contactEmail,
    contactPhone: group.contactPhone,
    websiteUrl: group.websiteUrl,
    facebookUrl: group.facebookUrl,
    instagramUrl: group.instagramUrl,
    youtubeUrl: group.youtubeUrl,
    isPublic: group.isPublic,
    isHidden: group.isHidden,
    memberInvitesAllowed: group.memberInvitesAllowed,
    publicCode: group.publicCode,
    status: group.status,
    timezone: group.timezone,
    currencyCode: group.currencyCode,
    country: group.country,
    city: group.city,
    createdAt: group.createdAt.toISOString(),
    updatedAt: group.updatedAt.toISOString(),
  };
}
