import { getCityByGeonameId, getCitiesForCountry } from './city-directory';

describe('city-directory', () => {
  describe('getCitiesForCountry', () => {
    it('returns known cities for a real country, each carrying its own country code and a geonameId', () => {
      const cities = getCitiesForCountry('PL');

      expect(cities.length).toBeGreaterThan(100);
      expect(cities.every((city) => city.country === 'PL')).toBe(true);
      expect(cities.every((city) => Number.isInteger(city.geonameId))).toBe(
        true,
      );
      expect(cities.some((city) => city.name === 'Kraków')).toBe(true);
    });

    it('resolves a region name for a city whose admin1 code has an entry in the source', () => {
      const cities = getCitiesForCountry('PL');
      const poznan = cities.find((city) => city.name === 'Poznań');

      expect(poznan?.region).toBe('Greater Poland');
    });

    it("includes each city's GeoNames alternate names", () => {
      const cities = getCitiesForCountry('PL');
      const warsaw = cities.find((city) => city.geonameId === 756135);

      expect(warsaw?.name).toBe('Warsaw');
      expect(warsaw?.alternateNames).toContain('Warszawa');
      // The primary name is never duplicated inside its own alternate list.
      expect(warsaw?.alternateNames).not.toContain('Warsaw');
    });

    it('returns an empty array for a country with no rows in the dataset', () => {
      expect(getCitiesForCountry('AQ')).toEqual([]);
    });
  });

  describe('getCityByGeonameId', () => {
    it('resolves the exact record for a known geonameId', () => {
      const record = getCityByGeonameId(756135);

      expect(record).toMatchObject({
        geonameId: 756135,
        name: 'Warsaw',
        country: 'PL',
        region: 'Mazovia',
      });
    });

    // Poland has two different towns both named "Piaski", in two different
    // regions - each has its own distinct, stable geonameId, which is
    // exactly the problem a geonameId-based identity check solves (see
    // group-validation.helpers.ts#refineCityIdentification).
    it('resolves each of two same-named cities to its own distinct record', () => {
      const first = getCityByGeonameId(762390);
      const second = getCityByGeonameId(3089217);

      expect(first).toMatchObject({ name: 'Piaski', region: 'Lublin' });
      expect(second).toMatchObject({
        name: 'Piaski',
        region: 'Greater Poland',
      });
      expect(first?.geonameId).not.toBe(second?.geonameId);
    });

    it('returns undefined for a geonameId that does not exist in the dataset', () => {
      expect(getCityByGeonameId(999999999999)).toBeUndefined();
    });
  });
});
