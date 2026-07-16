import { SongPerformer } from './song-performer.enum';

describe('SongPerformer', () => {
  it('defines exactly LEAD and CHORUS', () => {
    expect(Object.values(SongPerformer)).toEqual(['LEAD', 'CHORUS']);
  });
});
