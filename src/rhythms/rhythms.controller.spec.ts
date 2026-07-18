import { User } from '../users/entities/user.entity';
import { RhythmsController } from './rhythms.controller';
import { RhythmsService } from './rhythms.service';

function buildUser(): User {
  const user = new User();
  user.id = 'user-1';
  user.email = 'user@example.com';
  user.displayName = 'Test User';
  return user;
}

describe('RhythmsController', () => {
  describe('list', () => {
    it('delegates to RhythmsService.listPublic with search and instrumentId', async () => {
      const dto = [{ id: 'rhythm-1' }] as never;
      const listPublic = jest.fn().mockResolvedValue(dto);
      const controller = new RhythmsController({
        listPublic,
      } as unknown as RhythmsService);

      const response = await controller.list({
        search: 'bento',
        instrumentId: 'instrument-1',
      });

      expect(listPublic).toHaveBeenCalledWith('bento', 'instrument-1');
      expect(response).toBe(dto);
    });
  });

  describe('getBySlug', () => {
    it('delegates to RhythmsService.getPublicBySlug with the slug and current user id', async () => {
      const dto = { id: 'rhythm-1' } as never;
      const getPublicBySlug = jest.fn().mockResolvedValue(dto);
      const controller = new RhythmsController({
        getPublicBySlug,
      } as unknown as RhythmsService);
      const user = buildUser();

      const response = await controller.getBySlug('sao-bento-grande', user);

      expect(getPublicBySlug).toHaveBeenCalledWith(
        'sao-bento-grande',
        'user-1',
      );
      expect(response).toBe(dto);
    });
  });
});
