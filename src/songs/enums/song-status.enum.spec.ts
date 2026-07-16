import { SongStatus } from './song-status.enum';

describe('SongStatus', () => {
  it('defines exactly DRAFT, PENDING_REVIEW, PUBLISHED, REJECTED and HIDDEN', () => {
    expect(Object.values(SongStatus)).toEqual([
      'DRAFT',
      'PENDING_REVIEW',
      'PUBLISHED',
      'REJECTED',
      'HIDDEN',
    ]);
  });
});
