import { SongLineTranslation } from './song-line-translation.entity';

describe('SongLineTranslation', () => {
  it('holds a languageCode alongside the translated text', () => {
    const translation = new SongLineTranslation();
    translation.languageCode = 'pl';
    translation.text = 'Paraná, Paraná';

    expect(translation.languageCode).toBe('pl');
    expect(translation.text).toBe('Paraná, Paraná');
  });
});
