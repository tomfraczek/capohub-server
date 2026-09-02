import { SongLinePhonetic } from './song-line-phonetic.entity';

describe('SongLinePhonetic', () => {
  it('holds a languageCode alongside the phonetic text', () => {
    const phonetic = new SongLinePhonetic();
    phonetic.languageCode = 'pl';
    phonetic.text = 'paranaue, paranaue';

    expect(phonetic.languageCode).toBe('pl');
    expect(phonetic.text).toBe('paranaue, paranaue');
  });
});
