import { Injectable, Logger } from '@nestjs/common';

const GOOGLE_PEOPLE_API_URL =
  'https://people.googleapis.com/v1/people/me?personFields=photos';

interface GooglePeopleApiPhotosResponse {
  photos?: Array<{ default?: boolean }>;
}

/**
 * The one, thin adapter around the Google People API's `photos` field
 * (mirrors ExpoPushTransport's own minimal-adapter style - see that class's
 * comment). Its only job: given a Google OAuth access token, say whether
 * this account's current Google avatar is a real photo the user set, or
 * Google's own auto-generated "colored circle with an initial" default -
 * verified against the real API (module: profile-completion avatar step
 * bugfix) that `hasImage`/`imageUrl` alone (Clerk's own signals) cannot
 * tell apart, since Google reports an image either way. `photos[0].default`
 * is the one field that does: `true` for the auto-generated placeholder,
 * `false` for a real photo.
 *
 * Deliberately never throws - every failure mode (HTTP error, malformed
 * body, network failure) resolves to `null` ("unknown"), the same
 * conservative default UserService already uses for clerkHasImage. Never
 * logs the access token itself.
 */
@Injectable()
export class GooglePeopleApiService {
  private readonly logger = new Logger(GooglePeopleApiService.name);

  async resolveHasCustomPhoto(accessToken: string): Promise<boolean | null> {
    try {
      const response = await fetch(GOOGLE_PEOPLE_API_URL, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      if (!response.ok) {
        this.logger.warn(
          `Google People API responded with HTTP ${response.status}`,
        );
        return null;
      }

      const body = (await response.json()) as GooglePeopleApiPhotosResponse;
      const isDefaultAvatar = body.photos?.[0]?.default;

      if (typeof isDefaultAvatar !== 'boolean') {
        return null;
      }

      return !isDefaultAvatar;
    } catch (err) {
      this.logger.warn(
        `Failed to resolve Google avatar signal: ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    }
  }
}
