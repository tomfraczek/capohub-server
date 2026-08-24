import {
  PublicUrlBuilder,
  resolveImageUrl,
} from '../../storage/image-url.util';
import { Section } from '../entities/section.entity';
import { SectionResponseDto } from '../dto/section-response.dto';

export function toSectionResponseDto(
  section: Section,
  urlBuilder: PublicUrlBuilder,
): SectionResponseDto {
  return {
    id: section.id,
    parentGroupId: section.parentGroup?.id ?? null,
    name: section.name,
    description: section.description,
    logoUrl: resolveImageUrl(
      section.profileImageKey,
      section.logoUrl,
      urlBuilder,
    ),
    coverImageUrl: section.coverImageUrl,
    contactEmail: section.contactEmail,
    contactPhone: section.contactPhone,
    websiteUrl: section.websiteUrl,
    facebookUrl: section.facebookUrl,
    instagramUrl: section.instagramUrl,
    youtubeUrl: section.youtubeUrl,
    isPublic: section.isPublic,
    isHidden: section.isHidden,
    memberInvitesAllowed: section.memberInvitesAllowed,
    publicCode: section.publicCode,
    status: section.status,
    timezone: section.timezone,
    currencyCode: section.currencyCode,
    country: section.country,
    city: section.city,
    region: section.region,
    geonameId: section.geonameId,
    createdAt: section.createdAt.toISOString(),
    updatedAt: section.updatedAt.toISOString(),
  };
}
