import { RhythmsController } from './rhythms.controller';
import { RhythmsService } from './rhythms.service';

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
    it('delegates to RhythmsService.getPublicBySlug with the slug', async () => {
      const dto = { id: 'rhythm-1' } as never;
      const getPublicBySlug = jest.fn().mockResolvedValue(dto);
      const controller = new RhythmsController({
        getPublicBySlug,
      } as unknown as RhythmsService);

      const response = await controller.getBySlug('sao-bento-grande');

      expect(getPublicBySlug).toHaveBeenCalledWith('sao-bento-grande');
      expect(response).toBe(dto);
    });
  });
});
