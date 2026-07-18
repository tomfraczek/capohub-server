import { InstrumentsController } from './instruments.controller';
import { InstrumentsService } from './instruments.service';

describe('InstrumentsController', () => {
  describe('list', () => {
    it('delegates to InstrumentsService.listPublic with the search query', async () => {
      const dto = [{ id: 'instrument-1' }] as never;
      const listPublic = jest.fn().mockResolvedValue(dto);
      const controller = new InstrumentsController({
        listPublic,
      } as unknown as InstrumentsService);

      const response = await controller.list({ search: 'berim' });

      expect(listPublic).toHaveBeenCalledWith('berim');
      expect(response).toBe(dto);
    });
  });

  describe('getBySlug', () => {
    it('delegates to InstrumentsService.getPublicBySlug with the slug param', async () => {
      const dto = { id: 'instrument-1' } as never;
      const getPublicBySlug = jest.fn().mockResolvedValue(dto);
      const controller = new InstrumentsController({
        getPublicBySlug,
      } as unknown as InstrumentsService);

      const response = await controller.getBySlug('berimbau');

      expect(getPublicBySlug).toHaveBeenCalledWith('berimbau');
      expect(response).toBe(dto);
    });
  });
});
