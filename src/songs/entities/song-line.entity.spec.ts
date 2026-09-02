import { SongLine } from './song-line.entity';

describe('SongLine', () => {
  it('starts with empty phonetics and translations collections', () => {
    const line = new SongLine();
    expect(line.phonetics.getItems()).toEqual([]);
    expect(line.translations.getItems()).toEqual([]);
  });

  it('holds originalText independently of phonetics/translations', () => {
    const line = new SongLine();
    line.originalText = 'Paranauê, paranauê Paraná';

    expect(line.originalText).toBe('Paranauê, paranauê Paraná');
  });
});
