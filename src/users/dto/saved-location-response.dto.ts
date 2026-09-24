// One of the caller's own saved locations (GET/POST/PATCH .../me/locations)
// - never rendered on any *other* user's profile, this DTO backs only the
// "me" routes. `name` is `null` until the caller sets a custom label - the
// frontend falls back to `city`, then a generic "Zapisana lokalizacja"
// string, never a fabricated name (see SavedLocationsService's own comment).
export interface SavedLocationResponseDto {
  id: string;
  name: string | null;
  city: string | null;
  region: string | null;
  countryCode: string | null;
  latitude: number;
  longitude: number;
  radiusKm: number;
  notificationsEnabled: boolean;
  createdAt: string;
  updatedAt: string;
}
