import type { EntityManager } from '@mikro-orm/postgresql';
import { assertNotLeavingOwnedGroup } from './owner-formal-group';

function emOwning(groupIds: string[]): EntityManager {
  return {
    find: jest
      .fn()
      .mockResolvedValue(groupIds.map((id) => ({ group: { id } }))),
  } as unknown as EntityManager;
}

describe('assertNotLeavingOwnedGroup', () => {
  it('blocks an OWNER from ending their formal membership', async () => {
    await expect(
      assertNotLeavingOwnedGroup(emOwning(['g1']), 'u1', 'g1', null),
    ).rejects.toMatchObject({
      response: { code: 'OWNER_MUST_STAY_IN_FORMAL_GROUP' },
    });
  });

  it('blocks an OWNER from switching their formal group to another Group', async () => {
    await expect(
      assertNotLeavingOwnedGroup(emOwning(['g1']), 'u1', 'g1', 'g2'),
    ).rejects.toMatchObject({
      response: { code: 'OWNER_MUST_STAY_IN_FORMAL_GROUP' },
    });
  });

  it('lets an OWNER (e.g. a legacy one) move onto their own Group', async () => {
    await expect(
      assertNotLeavingOwnedGroup(emOwning(['g1']), 'u1', null, 'g1'),
    ).resolves.toBeUndefined();
  });

  it('never restricts a user who owns no live Group', async () => {
    await expect(
      assertNotLeavingOwnedGroup(emOwning([]), 'u1', 'g1', null),
    ).resolves.toBeUndefined();
  });
});
