import { GUARDS_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { User } from '../users/entities/user.entity';
import { CommunityHomeController } from './community-home.controller';
import { CommunityHomeService } from './community-home.service';
import { CommunityHomeResponseDto } from './dto/community-home-response.dto';

function buildController(
  communityHomeService: Partial<CommunityHomeService> = {},
): CommunityHomeController {
  return new CommunityHomeController(
    communityHomeService as CommunityHomeService,
  );
}

describe('CommunityHomeController', () => {
  // Deliberately NOT guarded by GroupPermissionsGuard: this endpoint
  // aggregates across every community the caller belongs to, so there is
  // no single :groupId to check a permission against at the controller
  // level (see class-level doc comment on CommunityHomeController).
  // Authorization for each section is instead resolved per-community
  // inside CommunityHomeService.
  it('carries no group-permission guard at the class level', () => {
    const reflector = new Reflector();

    const guards = reflector.get<unknown[]>(
      GUARDS_METADATA,
      CommunityHomeController,
    );

    expect(guards).toBeUndefined();
  });

  it('delegates GET /community/home to CommunityHomeService.getHome, scoped to the current user', async () => {
    const response = {
      myCommunities: [],
    } as unknown as CommunityHomeResponseDto;
    const getHome = jest.fn().mockResolvedValue(response);
    const controller = buildController({ getHome });
    const user = Object.assign(new User(), { id: 'user-1' });

    const result = await controller.getHome(user);

    expect(getHome).toHaveBeenCalledWith(user);
    expect(result).toBe(response);
  });
});
