import { INestApplication } from '@nestjs/common';
import { EntityManager, RequestContext } from '@mikro-orm/core';
import request from 'supertest';
import { App } from 'supertest/types';
import { FormalRankAssignmentResponseDto } from '../src/graduation/dto/formal-rank-assignment-response.dto';
import { PendingFormalRankResponseDto } from '../src/graduation/dto/formal-rank-request-response.dto';
import { FormalRankRequestsService } from '../src/graduation/formal-rank-requests.service';
import { RoleAssignment } from '../src/groups/entities/role-assignment.entity';
import { GroupRole } from '../src/groups/enums/group-role.enum';

/**
 * Test fixture: PUT /users/me/formal-rank and, when it only created a
 * pending FormalRankRequest (202 - the caller isn't their formal Group's
 * OWNER/ADMIN), approve it through the real FormalRankRequestsService.approve
 * acting as the Group's OWNER - for the many suites that just need "this
 * user holds this formal rank" as setup for something else. Approval only
 * skips the HTTP hop (the owner's token isn't known to every suite); the
 * domain logic is exactly the production one. The review endpoints
 * themselves are covered over HTTP in formal-rank.e2e-spec.ts.
 */
export async function setAndConfirmFormalRank(
  app: INestApplication<App>,
  token: string,
  body: Record<string, unknown>,
): Promise<FormalRankAssignmentResponseDto> {
  const put = await request(app.getHttpServer())
    .put('/api/v1/users/me/formal-rank')
    .set('Authorization', `Bearer ${token}`)
    .send(body);
  if (put.status === 200) {
    return put.body as FormalRankAssignmentResponseDto;
  }
  if (put.status !== 202) {
    throw new Error(
      `PUT /users/me/formal-rank: expected 200/202, got ${put.status} ${JSON.stringify(put.body)}`,
    );
  }
  const { pendingRequest } = put.body as PendingFormalRankResponseDto;

  const em = app.get(EntityManager);
  await RequestContext.create(em, async () => {
    const owner = await em.fork().findOneOrFail(
      RoleAssignment,
      {
        group: pendingRequest.group.id,
        role: GroupRole.OWNER,
        revokedAt: null,
      },
      { populate: ['user'] },
    );
    await app
      .get(FormalRankRequestsService)
      .approve(pendingRequest.group.id, pendingRequest.id, owner.user);
  });

  const current = await request(app.getHttpServer())
    .get('/api/v1/users/me/formal-rank')
    .set('Authorization', `Bearer ${token}`)
    .expect(200);
  return current.body as FormalRankAssignmentResponseDto;
}
