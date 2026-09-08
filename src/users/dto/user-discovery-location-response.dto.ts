// The caller's own discovery location, or null when none is set yet (GET
// .../me/discovery-location) - row-presence in UserDiscoveryLocation *is*
// "configured", so this is a plain nullable DTO, not a
// `{configured, ...fields}` wrapper the way CommunityHomeResponseDto's
// `location` block is (that one additionally needs `configured: false` to
// coexist with a response that still has real `mySections`/`myGroups` data -
// see community-home-response.dto.ts's own comment). Never rendered on any
// *other* user's profile - this DTO backs only the "me" routes.
export interface UserDiscoveryLocationResponseDto {
  city: string;
  region: string | null;
  countryCode: string;
  latitude: number;
  longitude: number;
  displayName: string | null;
  source: string | null;
  updatedAt: string;
}
