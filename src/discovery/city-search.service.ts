import { Injectable } from '@nestjs/common';
import { CityRecord, getAllCities, getCitiesForCountry } from '../common/geo/city-directory';
import { CityResultDto } from './dto/city-result.dto';
import { CitySearchQuery } from './dto/city-search-query.schema';
import { PlaceSearchResultDto } from './dto/place-search-result.dto';
import { PlaceSearchQuery } from './dto/place-search-query.schema';

// Backs GET /discovery/cities - lets the frontend offer "pick a city"
// constrained to a previously-chosen country, without shipping any part of
// the underlying world dataset to the client itself (see
// common/geo/city-directory.ts for the data source and its own reasoning).
// Deliberately its own service, not folded into DiscoveryService: this
// searches a static, in-memory geographic reference dataset, not the
// Group/Section aggregate DiscoveryService searches - two unrelated data
// sources that only happen to share a controller.
// Shared by both search() (one pre-chosen country) and searchPlaces()
// (every country at once) - name matches by partial substring, alternate
// names by exact match. See search()'s own historical comment below for
// why the two matching rules differ from each other.
function matchesSearchText(city: CityRecord, searchText: string): boolean {
  return (
    city.name.toLowerCase().includes(searchText) ||
    city.alternateNames.some((alt) => alt.toLowerCase() === searchText)
  );
}

// Same tiebreaker chain both search() and searchPlaces() sort by - name
// first, region as a tiebreaker so same-named cities sort deterministically
// relative to each other, geonameId as a final tiebreaker for total
// determinism (population is not part of this dataset's shape - see
// city-directory.ts).
function compareCities(a: CityRecord, b: CityRecord): number {
  const byName = a.name.localeCompare(b.name);
  if (byName !== 0) return byName;
  const byRegion = (a.region ?? '').localeCompare(b.region ?? '');
  if (byRegion !== 0) return byRegion;
  return a.geonameId - b.geonameId;
}

@Injectable()
export class CitySearchService {
  search(query: CitySearchQuery): CityResultDto[] {
    const cities = getCitiesForCountry(query.country);

    const searchText = query.search?.toLowerCase();
    // `name` matches by partial (typeahead-friendly) substring, same as
    // before - showing several real candidates while the caller is still
    // typing is exactly the point of a picker, and every candidate's own
    // *displayed* name visibly contains what was typed (e.g. "Wola"
    // legitimately surfaces "Wola Uhruska", "Wola Rębkowska", etc. - all
    // real places whose name really does start with "Wola"), so more
    // results here is a feature, not a false positive.
    //
    // Alternate names (see city-directory.ts) match *exactly* instead - a
    // prefix or substring match was considered and rejected, because it
    // would surface results whose *displayed* `name` has no visible
    // relationship to the search term at all: GeoNames' alternatenames
    // column routinely constructs a *different, nearby* place's alternate
    // name by prefixing this city's own name plus a separator -
    // "Warszawa-Śródmieście" and "Warszawa-Ursus" (both real, distinct
    // Warsaw districts, each displayed under its own `name`) start with
    // "Warszawa" exactly as much as "Warszawa" itself does. A prefix or
    // substring match on alternate names would resurface both - each
    // displayed as "Śródmieście"/"Ursus", visibly unrelated to a "Warszawa"
    // query - for what the caller typed as a complete, exact known synonym,
    // not a still-in-progress partial name. Confirmed empirically by
    // scanning the bundled dataset: this compound-name pattern alone
    // accounts for 105 such alternate-name collisions among Polish places
    // (e.g. "Kamieniec Poznańskie" vs. "Poznań"), so it is not a rare edge
    // case worth accepting for partial-typing convenience on this field. An
    // *exact* match against one specific alternate name has no such risk,
    // and is exactly what a "resolve a known synonym" lookup needs:
    // "Warszawa" finds the one record also findable as "Warsaw" (same
    // geonameId, same displayed name) - see city-search.service.spec.ts.
    const filtered = searchText ? cities.filter((city) => matchesSearchText(city, searchText)) : cities;

    const sorted = [...filtered].sort(compareCities);
    const page = sorted.slice(0, query.limit);

    // `region` is always whatever the dataset itself resolves for this city
    // (see city-directory.ts) - never withheld or nulled out based on
    // `search`, `limit`, or whether another same-named city happens to
    // appear elsewhere in the result set. A field whose presence depended on
    // "did some other row also come back" would make the same city's shape
    // change across requests for no reason tied to that city itself (see
    // CityResultDto's own comment).
    return page.map((city) => ({
      geonameId: city.geonameId,
      name: city.name,
      country: city.country,
      region: city.region,
    }));
  }

  // Backs GET /discovery/places - the manual discovery-location search
  // (task: "Ręczne wyszukiwanie lokalizacji musi działać bez GPS
  // permission"). Unlike search() above, this scans every country at once
  // (a caller here has only a bare typed place name, never a pre-chosen
  // country to scope by) and always returns real coordinates, never a
  // geonameId-only reference - see PlaceSearchResultDto's own comment.
  // `search` is required (see placeSearchQuerySchema) - there is no
  // "browse everything" mode here at all.
  searchPlaces(query: PlaceSearchQuery): PlaceSearchResultDto[] {
    const searchText = query.search.toLowerCase();
    const matched = getAllCities().filter((city) => matchesSearchText(city, searchText));

    const sorted = [...matched].sort(compareCities);
    const page = sorted.slice(0, query.limit);

    return page.map((city) => ({
      geonameId: city.geonameId,
      city: city.name,
      region: city.region,
      countryCode: city.country,
      latitude: city.latitude,
      longitude: city.longitude,
    }));
  }
}
