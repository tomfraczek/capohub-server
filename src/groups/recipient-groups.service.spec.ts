import type { EntityManager } from '@mikro-orm/postgresql';
import { GroupHierarchyService } from './group-hierarchy.service';
import { RoleAssignmentsService } from './role-assignments.service';
import { RecipientGroupsService } from './recipient-groups.service';
import { PublicUrlBuilder } from '../storage/image-url.util';
import { User } from '../users/entities/user.entity';
import { AvatarType } from '../users/enums/avatar-type.enum';

function buildUrlBuilder(): PublicUrlBuilder {
  return { buildPublicUrl: (key) => `https://cdn.example.com/${key}` };
}

function buildUser(overrides: Partial<User> = {}): User {
  const user = new User();
  user.id = 'user-1';
  user.displayName = 'Mestre Bimba';
  user.avatarType = AvatarType.CLERK;
  user.avatarUrl = null;
  return Object.assign(user, overrides);
}

function buildService(items: User[]) {
  const roleAssignmentsService = {
    findEligibleMembers: jest
      .fn()
      .mockResolvedValue({ items, total: items.length }),
  } as unknown as RoleAssignmentsService;
  const groupHierarchyService = {} as unknown as GroupHierarchyService;

  return new RecipientGroupsService(
    {} as unknown as EntityManager,
    roleAssignmentsService,
    groupHierarchyService,
    buildUrlBuilder() as never,
  );
}

describe('RecipientGroupsService.listEligibleMembers', () => {
  it('prefers the R2 public URL derived from avatarImageKey over the legacy avatarUrl', async () => {
    const user = buildUser({
      avatarType: AvatarType.UPLOAD,
      avatarUrl: null,
      avatarImageKey: 'users/user-1/profile/uuid.webp',
    });
    const service = buildService([user]);

    const result = await service.listEligibleMembers('group-1', {
      limit: 20,
      offset: 0,
    });

    expect(result.items[0].avatarUrl).toBe(
      'https://cdn.example.com/users/user-1/profile/uuid.webp',
    );
  });

  it('falls back to the legacy avatarUrl when avatarImageKey is unset', async () => {
    const user = buildUser({
      avatarType: AvatarType.CLERK,
      avatarUrl: 'https://img.clerk.com/bimba.png',
    });
    const service = buildService([user]);

    const result = await service.listEligibleMembers('group-1', {
      limit: 20,
      offset: 0,
    });

    expect(result.items[0].avatarUrl).toBe('https://img.clerk.com/bimba.png');
  });
});
