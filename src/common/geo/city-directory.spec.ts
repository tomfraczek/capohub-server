import { getCitiesForCountry, isKnownCity } from './city-directory';

describe('city-directory', () => {
  describe('getCitiesForCountry', () => {
    it('returns known cities for a real country, each carrying its own country code', () => {
      const cities = getCitiesForCountry('PL');

      expect(cities.length).toBeGreaterThan(100);
      expect(cities.every((city) => city.country === 'PL')).toBe(true);
      expect(cities.some((city) => city.name === 'Kraków')).toBe(true);
    });

    it('resolves a region name for a city whose admin1 code has an entry in admin1.json', () => {
      const cities = getCitiesForCountry('PL');
      const poznan = cities.find((city) => city.name === 'Poznań');

      expect(poznan?.region).toBe('Greater Poland');
    });

    it('returns an empty array for a country with no rows in the dataset', () => {
      expect(getCitiesForCountry('AQ')).toEqual([]);
    });
  });

  describe('isKnownCity', () => {
    it('matches case-insensitively and ignores surrounding whitespace', () => {
      expect(isKnownCity('PL', 'Kraków')).toBe(true);
      expect(isKnownCity('PL', 'kraków')).toBe(true);
      expect(isKnownCity('PL', '  KRAKÓW  ')).toBe(true);
    });

    it('rejects a city that does not belong to the given country', () => {
      expect(isKnownCity('DE', 'Kraków')).toBe(false);
    });

    it('rejects a made-up city name', () => {
      expect(isKnownCity('PL', 'Not A Real City Name')).toBe(false);
    });
  });
});
