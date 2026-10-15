import { UserGender } from '../users/enums/user-gender.enum';
import { resolveRankName } from './rank-name.util';

describe('resolveRankName', () => {
  const professor = { name: 'Professor', nameFemale: 'Professora' };

  it('gives a FEMALE holder the feminine form', () => {
    expect(resolveRankName(professor, UserGender.FEMALE)).toBe('Professora');
  });

  it('gives MALE, UNDISCLOSED and a not-yet-set gender the masculine/default form', () => {
    expect(resolveRankName(professor, UserGender.MALE)).toBe('Professor');
    expect(resolveRankName(professor, UserGender.UNDISCLOSED)).toBe(
      'Professor',
    );
    expect(resolveRankName(professor, null)).toBe('Professor');
    expect(resolveRankName(professor, undefined)).toBe('Professor');
  });

  it('falls back to name for a FEMALE holder of a legacy rank without a feminine form', () => {
    expect(
      resolveRankName(
        { name: 'Professor', nameFemale: null },
        UserGender.FEMALE,
      ),
    ).toBe('Professor');
  });
});
