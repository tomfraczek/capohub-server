import { SongLine } from './song-line.entity';

describe('SongLine', () => {
  it('defaults phoneticText to null', () => {
    const line = new SongLine();
    expect(line.phoneticText).toBeNull();
  });

  it('accepts a set phoneticText alongside originalText', () => {
    const line = new SongLine();
    line.originalText = 'Paranauê, paranauê Paraná';
    line.phoneticText = 'pa-ra-na-oo-eh';

    expect(line.originalText).toBe('Paranauê, paranauê Paraná');
    expect(line.phoneticText).toBe('pa-ra-na-oo-eh');
  });
});
