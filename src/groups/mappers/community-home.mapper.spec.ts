import { PublicUrlBuilder } from '../../storage/image-url.util';
import { Group } from '../entities/group.entity';
import { GroupStatus } from '../enums/group-status.enum';
import { GroupRole } from '../enums/group-role.enum';
import {
  toCommunityHomeCommunityDto,
  toCommunityHomeCommunityRefDto,
} from './community-home.mapper';

function buildUrlBuilder(): PublicUrlBuilder {
  return { buildPublicUrl: (key) => `https://cdn.example.com/${key}` };
}

function buildGroup(overrides: Partial<Group> = {}): Group {
  const group = new Group();
  group.id = 'group-1';
  group.name = 'Capoeira Angola SP';
  group.status = GroupStatus.ACTIVE;
  group.parentGroup = null;
  group.isPublic = true;
  group.isHidden = false;
  return Object.assign(group, overrides);
}

describe('toCommunityHomeCommunityRefDto', () => {
  it('prefers the R2 public URL derived from profileImageKey over the legacy logoUrl', () => {
    const group = buildGroup({
      logoUrl: 'https://legacy.example.com/old-logo.png',
      profileImageKey: 'groups/group-1/profile/uuid.webp',
    });

    const dto = toCommunityHomeCommunityRefDto(group, buildUrlBuilder());

    expect(dto.logoUrl).toBe(
      'https://cdn.example.com/groups/group-1/profile/uuid.webp',
    );
  });

  it('falls back to the legacy logoUrl when profileImageKey is unset', () => {
    const group = buildGroup({
      logoUrl: 'https://legacy.example.com/old-logo.png',
    });

    const dto = toCommunityHomeCommunityRefDto(group, buildUrlBuilder());

    expect(dto.logoUrl).toBe('https://legacy.example.com/old-logo.png');
  });

  it('returns null when neither profileImageKey nor the legacy logoUrl is set', () => {
    const group = buildGroup();

    const dto = toCommunityHomeCommunityRefDto(group, buildUrlBuilder());

    expect(dto.logoUrl).toBeNull();
  });
});

describe('toCommunityHomeCommunityDto', () => {
  it('prefers the R2 public URL derived from profileImageKey over the legacy logoUrl', () => {
    const group = buildGroup({
      logoUrl: 'https://legacy.example.com/old-logo.png',
      profileImageKey: 'groups/group-1/profile/uuid.webp',
    });

    const dto = toCommunityHomeCommunityDto(
      group,
      'group-1',
      [GroupRole.OWNER],
      buildUrlBuilder(),
    );

    expect(dto.logoUrl).toBe(
      'https://cdn.example.com/groups/group-1/profile/uuid.webp',
    );
  });
});
