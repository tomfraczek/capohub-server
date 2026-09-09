/**
 * E2E tests for Cloudflare R2 image storage (module: "R2: upload/replace/
 * delete zdjęć dla User/Group/Section/Event"): the five multipart
 * upload/delete endpoints (PUT/DELETE .../profile-image ×3,
 * PUT/DELETE .../cover-image ×2 - Event and Group) - replace flow, delete
 * flow, invalid MIME, oversize, and permission gating.
 *
 * R2StorageService is overridden with an in-memory fake (see
 * FakeR2StorageService below) - no request ever reaches real Cloudflare
 * (module spec §38/§46). ImageProcessingService is NOT mocked - every
 * upload here goes through real Sharp processing, so these tests also
 * prove the full multipart -> multer -> Sharp -> "R2" -> DB pipeline works
 * end to end, not just that the right mocks were called.
 */
import {
  INestApplication,
  UnauthorizedException,
  VersioningType,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { EntityManager } from '@mikro-orm/core';
import request from 'supertest';
import { App } from 'supertest/types';
import sharp from 'sharp';
import { AppModule } from '../src/app.module';
import { ClerkAuthService } from '../src/auth/clerk/clerk-auth.service';
import { CLERK_CLIENT } from '../src/auth/clerk/clerk-client.provider';
import { AuthContext } from '../src/auth/types/auth-context.type';
import { AppConfigService } from '../src/config/app.config';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';
import { HttpErrorResponse } from '../src/common/types/http-error-response.type';
import { closeE2eApp } from './close-e2e-app.helper';
import { R2StorageService } from '../src/storage/r2-storage.service';
import { User } from '../src/users/entities/user.entity';
import { UserResponseDto } from '../src/users/dto/user-response.dto';
import { AvatarType } from '../src/users/enums/avatar-type.enum';
import { AuditLogEntry } from '../src/groups/entities/audit-log-entry.entity';
import { Group } from '../src/groups/entities/group.entity';
import { Section } from '../src/groups/entities/section.entity';
import { RoleAssignment } from '../src/groups/entities/role-assignment.entity';
import { GroupResponseDto } from '../src/groups/dto/group-response.dto';
import { SectionResponseDto } from '../src/groups/dto/section-response.dto';
import { EventResponseDto } from '../src/events/dto/event-response.dto';
import { EventRoleAssignment } from '../src/events/entities/event-role-assignment.entity';
import { EventStatusHistory } from '../src/events/entities/event-status-history.entity';
import { Event } from '../src/events/entities/event.entity';
import { EventVisibility } from '../src/events/enums/event-visibility.enum';
import { EventWaitlistPolicy } from '../src/events/enums/event-waitlist-policy.enum';

/**
 * In-memory stand-in for R2StorageService (module spec §38: "R2
 * client/storage mock/fake" - never a real Cloudflare request). Overridden
 * once for the whole app under test - see beforeAll. Exposes `objects` so
 * tests can assert an old object was physically removed on replace/delete
 * (module spec §22 "potwierdzenie, że stare zdjęcie jest fizycznie
 * usuwane").
 */
class FakeR2StorageService {
  readonly objects = new Map<string, Buffer>();

  putObject(key: string, body: Buffer): Promise<void> {
    this.objects.set(key, body);
    return Promise.resolve();
  }

  deleteObject(key: string): Promise<void> {
    this.objects.delete(key);
    return Promise.resolve();
  }

  buildPublicUrl(key: string): string {
    return `https://fake-r2.test/${key}`;
  }
}

const OWNER_TOKEN = 'valid-image-storage-owner-token';
const OUTSIDER_TOKEN = 'valid-image-storage-outsider-token';

const OWNER_CLERK_ID = 'user_test_image_storage_owner';
const OUTSIDER_CLERK_ID = 'user_test_image_storage_outsider';

const TOKEN_TO_AUTH: Record<string, AuthContext> = {
  [OWNER_TOKEN]: {
    userId: OWNER_CLERK_ID,
    sessionId: 'sess_image_storage_owner',
    tokenType: 'session_token',
    claims: { sub: OWNER_CLERK_ID, sid: 'sess_image_storage_owner' },
  },
  [OUTSIDER_TOKEN]: {
    userId: OUTSIDER_CLERK_ID,
    sessionId: 'sess_image_storage_outsider',
    tokenType: 'session_token',
    claims: { sub: OUTSIDER_CLERK_ID, sid: 'sess_image_storage_outsider' },
  },
};

const FIXTURE_CLERK_PROFILES: Record<
  string,
  { imageUrl: string; primaryEmailAddress: { emailAddress: string } | null }
> = {
  [OWNER_CLERK_ID]: {
    imageUrl: 'https://img.clerk.com/image-storage-owner.png',
    primaryEmailAddress: { emailAddress: 'image.storage.owner@example.com' },
  },
  [OUTSIDER_CLERK_ID]: {
    imageUrl: 'https://img.clerk.com/image-storage-outsider.png',
    primaryEmailAddress: {
      emailAddress: 'image.storage.outsider@example.com',
    },
  },
};

const TEST_CLERK_USER_IDS = Object.keys(FIXTURE_CLERK_PROFILES);

const fixtureClerkAuthService = {
  verifySessionToken: (token: string) => {
    const auth = TOKEN_TO_AUTH[token];
    if (auth) {
      return Promise.resolve(auth);
    }
    return Promise.reject(new UnauthorizedException('Authentication required'));
  },
};

const fixtureClerkClient = {
  users: {
    getUser: (clerkUserId: string) => {
      const profile = FIXTURE_CLERK_PROFILES[clerkUserId];
      if (!profile) {
        return Promise.reject(
          new Error(`Unknown test Clerk user ${clerkUserId}`),
        );
      }
      return Promise.resolve({ id: clerkUserId, ...profile });
    },
    deleteUser: () => Promise.resolve(),
  },
};

async function bodyOf<T>(req: request.Test): Promise<T> {
  const res = await req;
  return res.body as T;
}

// Real, tiny, synthetically generated images - see
// src/storage/image-processing.service.spec.ts's identical rationale.
async function buildJpeg(): Promise<Buffer> {
  return sharp({
    create: {
      width: 800,
      height: 600,
      channels: 3,
      background: { r: 200, g: 50, b: 50 },
    },
  })
    .jpeg()
    .toBuffer();
}

async function buildPng(): Promise<Buffer> {
  return sharp({
    create: {
      width: 400,
      height: 400,
      channels: 4,
      background: { r: 10, g: 200, b: 10, alpha: 1 },
    },
  })
    .png()
    .toBuffer();
}

describe('Image storage (R2) (e2e)', () => {
  let app: INestApplication<App>;
  const fakeR2Storage = new FakeR2StorageService();
  const createdGroupIds: string[] = [];
  const createdSectionIds: string[] = [];
  const createdEventIds: string[] = [];

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(ClerkAuthService)
      .useValue(fixtureClerkAuthService)
      .overrideProvider(CLERK_CLIENT)
      .useValue(fixtureClerkClient)
      .overrideProvider(R2StorageService)
      .useValue(fakeR2Storage)
      .compile();

    app = moduleFixture.createNestApplication();
    const appConfig = app.get(AppConfigService);
    app.setGlobalPrefix(appConfig.apiPrefix);
    app.enableVersioning({
      type: VersioningType.URI,
      defaultVersion: appConfig.apiVersion,
      prefix: false,
    });
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();

    for (const token of Object.keys(TOKEN_TO_AUTH)) {
      await request(app.getHttpServer())
        .get('/api/v1/users/me')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
    }
  });

  afterAll(async () => {
    await closeE2eApp(app, async () => {
      const cleanup = app.get(EntityManager).fork();
      if (createdEventIds.length > 0) {
        const eventFilter = { event: { $in: createdEventIds } };
        await cleanup.nativeDelete(EventRoleAssignment, eventFilter);
        await cleanup.nativeDelete(EventStatusHistory, eventFilter);
        await cleanup.nativeDelete(Event, { id: { $in: createdEventIds } });
      }
      const communityIds = [...createdGroupIds, ...createdSectionIds];
      await cleanup.nativeDelete(RoleAssignment, {
        $or: [
          { group: { $in: communityIds } },
          { section: { $in: communityIds } },
        ],
      });
      await cleanup.nativeDelete(AuditLogEntry, {
        $or: [
          { group: { $in: communityIds } },
          { section: { $in: communityIds } },
        ],
      });
      await cleanup.nativeDelete(Section, { id: { $in: createdSectionIds } });
      await cleanup.nativeDelete(Group, { id: { $in: createdGroupIds } });
      await cleanup.nativeDelete(User, {
        clerkUserId: { $in: TEST_CLERK_USER_IDS },
      });
    });
  });

  async function createGroup(): Promise<GroupResponseDto> {
    const created = await bodyOf<GroupResponseDto>(
      request(app.getHttpServer())
        .post('/api/v1/groups')
        .set('Authorization', `Bearer ${OWNER_TOKEN}`)
        .send({
          name: 'Image Storage Test Group',
          description: null,
          logoUrl: 'https://legacy.example.com/old-group-logo.png',
          coverImageUrl: null,
          contactEmail: null,
          contactPhone: null,
          websiteUrl: null,
          facebookUrl: null,
          instagramUrl: null,
          youtubeUrl: null,
          isPublic: true,
          isHidden: false,
          memberInvitesAllowed: false,
        })
        .expect(201),
    );
    createdGroupIds.push(created.id);
    return created;
  }

  async function createSection(): Promise<SectionResponseDto> {
    const created = await bodyOf<SectionResponseDto>(
      request(app.getHttpServer())
        .post('/api/v1/sections')
        .set('Authorization', `Bearer ${OWNER_TOKEN}`)
        .send({
          name: 'Image Storage Test Section',
          description: null,
          logoUrl: 'https://legacy.example.com/old-section-logo.png',
          coverImageUrl: null,
          contactEmail: null,
          contactPhone: null,
          websiteUrl: null,
          facebookUrl: null,
          instagramUrl: null,
          youtubeUrl: null,
          isPublic: true,
          isHidden: false,
          memberInvitesAllowed: false,
          timezone: 'Europe/Warsaw',
          currencyCode: 'PLN',
          country: 'PL',
          city: 'Warsaw',
          region: 'Mazovia',
          geonameId: 756135,
        })
        .expect(201),
    );
    createdSectionIds.push(created.id);
    return created;
  }

  async function createPersonalEvent(): Promise<EventResponseDto> {
    const created = await bodyOf<EventResponseDto>(
      request(app.getHttpServer())
        .post('/api/v1/events')
        .set('Authorization', `Bearer ${OWNER_TOKEN}`)
        .send({
          type: 'WORKSHOP',
          customTypeLabel: null,
          name: 'Image Storage Test Event',
          description: null,
          coverImageUrl: 'https://legacy.example.com/old-cover.png',
          startsAt: '2027-03-10T10:00:00.000Z',
          endsAt: '2027-03-10T18:00:00.000Z',
          locationName: null,
          locationAddress: null,
          visibility: EventVisibility.PUBLIC,
          capacity: null,
          waitlistPolicy: EventWaitlistPolicy.NONE,
        })
        .expect(201),
    );
    createdEventIds.push(created.id);
    return created;
  }

  // ─── User avatar ────────────────────────────────────────────────────────

  describe('User profile-image (PUT/DELETE /users/me/profile-image)', () => {
    it('uploads a JPEG, converting it to an R2-hosted WebP avatar', async () => {
      const dto = await bodyOf<UserResponseDto>(
        request(app.getHttpServer())
          .put('/api/v1/users/me/profile-image')
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .attach('file', await buildJpeg(), 'photo.jpg')
          .expect(200),
      );

      expect(dto.avatarType).toBe(AvatarType.UPLOAD);
      expect(dto.presetAvatarId).toBeNull();
      expect(dto.avatarUrl).toMatch(
        /^https:\/\/fake-r2\.test\/users\/.+\/profile\/.+\.webp$/,
      );
      const key = dto.avatarUrl!.replace('https://fake-r2.test/', '');
      expect(fakeR2Storage.objects.has(key)).toBe(true);
    });

    it('replace: uploading again removes the previous R2 object', async () => {
      const first = await bodyOf<UserResponseDto>(
        request(app.getHttpServer())
          .put('/api/v1/users/me/profile-image')
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .attach('file', await buildPng(), 'first.png')
          .expect(200),
      );
      const firstKey = first.avatarUrl!.replace('https://fake-r2.test/', '');
      expect(fakeR2Storage.objects.has(firstKey)).toBe(true);

      const second = await bodyOf<UserResponseDto>(
        request(app.getHttpServer())
          .put('/api/v1/users/me/profile-image')
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .attach('file', await buildJpeg(), 'second.jpg')
          .expect(200),
      );
      const secondKey = second.avatarUrl!.replace('https://fake-r2.test/', '');

      expect(secondKey).not.toBe(firstKey);
      expect(fakeR2Storage.objects.has(firstKey)).toBe(false);
      expect(fakeR2Storage.objects.has(secondKey)).toBe(true);
    });

    it('delete: removes the R2 object and falls back to the Clerk avatar', async () => {
      const uploaded = await bodyOf<UserResponseDto>(
        request(app.getHttpServer())
          .put('/api/v1/users/me/profile-image')
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .attach('file', await buildJpeg(), 'photo.jpg')
          .expect(200),
      );
      const key = uploaded.avatarUrl!.replace('https://fake-r2.test/', '');

      const deleted = await bodyOf<UserResponseDto>(
        request(app.getHttpServer())
          .delete('/api/v1/users/me/profile-image')
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .expect(200),
      );

      expect(deleted.avatarType).toBe(AvatarType.CLERK);
      expect(deleted.avatarUrl).toBe(
        FIXTURE_CLERK_PROFILES[OWNER_CLERK_ID].imageUrl,
      );
      expect(fakeR2Storage.objects.has(key)).toBe(false);
    });

    it('delete is idempotent when there is no uploaded avatar to remove', async () => {
      await request(app.getHttpServer())
        .delete('/api/v1/users/me/profile-image')
        .set('Authorization', `Bearer ${OWNER_TOKEN}`)
        .expect(200);
    });

    it('rejects an unsupported MIME type with IMAGE_UNSUPPORTED_TYPE', async () => {
      const res = await request(app.getHttpServer())
        .put('/api/v1/users/me/profile-image')
        .set('Authorization', `Bearer ${OWNER_TOKEN}`)
        .attach('file', Buffer.from('%PDF-1.4 fake pdf'), {
          filename: 'file.pdf',
          contentType: 'application/pdf',
        })
        .expect(400);

      expect((res.body as HttpErrorResponse).code).toBe(
        'IMAGE_UNSUPPORTED_TYPE',
      );
    });

    it('rejects an SVG upload', async () => {
      const res = await request(app.getHttpServer())
        .put('/api/v1/users/me/profile-image')
        .set('Authorization', `Bearer ${OWNER_TOKEN}`)
        .attach('file', Buffer.from('<svg></svg>'), {
          filename: 'file.svg',
          contentType: 'image/svg+xml',
        })
        .expect(400);

      expect((res.body as HttpErrorResponse).code).toBe(
        'IMAGE_UNSUPPORTED_TYPE',
      );
    });

    it('rejects a file over the 10 MB limit with IMAGE_TOO_LARGE', async () => {
      const oversized = Buffer.alloc(10 * 1024 * 1024 + 1024, 1);

      const res = await request(app.getHttpServer())
        .put('/api/v1/users/me/profile-image')
        .set('Authorization', `Bearer ${OWNER_TOKEN}`)
        .attach('file', oversized, {
          filename: 'big.jpg',
          contentType: 'image/jpeg',
        })
        .expect(413);

      expect((res.body as HttpErrorResponse).code).toBe('IMAGE_TOO_LARGE');
    });

    it('rejects a renamed non-image file that merely claims to be a JPEG', async () => {
      const res = await request(app.getHttpServer())
        .put('/api/v1/users/me/profile-image')
        .set('Authorization', `Bearer ${OWNER_TOKEN}`)
        .attach('file', Buffer.from('MZ\x90\x00 not really a jpeg'), {
          filename: 'malware.jpg',
          contentType: 'image/jpeg',
        })
        .expect(400);

      expect((res.body as HttpErrorResponse).code).toBe('IMAGE_INVALID');
    });

    it('rejects a request with no file attached', async () => {
      const res = await request(app.getHttpServer())
        .put('/api/v1/users/me/profile-image')
        .set('Authorization', `Bearer ${OWNER_TOKEN}`)
        .expect(400);

      expect((res.body as HttpErrorResponse).code).toBe('IMAGE_REQUIRED');
    });
  });

  // ─── Group profile image ───────────────────────────────────────────────

  describe('Group profile-image (PUT/DELETE /groups/:id/profile-image)', () => {
    it('uploads a profile image, clearing the legacy logoUrl', async () => {
      const group = await createGroup();

      const dto = await bodyOf<GroupResponseDto>(
        request(app.getHttpServer())
          .put(`/api/v1/groups/${group.id}/profile-image`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .attach('file', await buildJpeg(), 'logo.jpg')
          .expect(200),
      );

      expect(dto.logoUrl).toMatch(
        /^https:\/\/fake-r2\.test\/groups\/.+\/profile\/.+\.webp$/,
      );
    });

    it('replace then delete: the old object is physically removed each time, and delete never restores the pre-upload legacy logoUrl', async () => {
      const group = await createGroup();

      const first = await bodyOf<GroupResponseDto>(
        request(app.getHttpServer())
          .put(`/api/v1/groups/${group.id}/profile-image`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .attach('file', await buildJpeg(), 'logo1.jpg')
          .expect(200),
      );
      const firstKey = first.logoUrl!.replace('https://fake-r2.test/', '');

      const second = await bodyOf<GroupResponseDto>(
        request(app.getHttpServer())
          .put(`/api/v1/groups/${group.id}/profile-image`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .attach('file', await buildPng(), 'logo2.png')
          .expect(200),
      );
      const secondKey = second.logoUrl!.replace('https://fake-r2.test/', '');
      expect(fakeR2Storage.objects.has(firstKey)).toBe(false);
      expect(fakeR2Storage.objects.has(secondKey)).toBe(true);

      const deleted = await bodyOf<GroupResponseDto>(
        request(app.getHttpServer())
          .delete(`/api/v1/groups/${group.id}/profile-image`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .expect(200),
      );

      expect(fakeR2Storage.objects.has(secondKey)).toBe(false);
      // Never resurrects the original 'https://legacy.example.com/...'
      // logoUrl the Group was created with (module spec §27).
      expect(deleted.logoUrl).toBeNull();
    });

    it('denies a caller with no Role Assignment at all on the Group (404, never 403)', async () => {
      const group = await createGroup();

      const res = await request(app.getHttpServer())
        .put(`/api/v1/groups/${group.id}/profile-image`)
        .set('Authorization', `Bearer ${OUTSIDER_TOKEN}`)
        .attach('file', await buildJpeg(), 'logo.jpg')
        .expect(404);

      expect((res.body as HttpErrorResponse).code).toBe('GROUP_NOT_FOUND');
    });
  });

  // ─── Group cover image ──────────────────────────────────────────────────

  describe('Group cover-image (PUT/DELETE /groups/:id/cover-image)', () => {
    it('uploads a 1600x900 cover, clearing the legacy coverImageUrl', async () => {
      const group = await createGroup();

      const dto = await bodyOf<GroupResponseDto>(
        request(app.getHttpServer())
          .put(`/api/v1/groups/${group.id}/cover-image`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .attach('file', await buildJpeg(), 'cover.jpg')
          .expect(200),
      );

      expect(dto.coverImageUrl).toMatch(
        /^https:\/\/fake-r2\.test\/groups\/.+\/cover\/.+\.webp$/,
      );
    });

    it('replace then delete: the old object is physically removed each time, and delete never restores the pre-upload legacy coverImageUrl', async () => {
      const group = await createGroup();

      const first = await bodyOf<GroupResponseDto>(
        request(app.getHttpServer())
          .put(`/api/v1/groups/${group.id}/cover-image`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .attach('file', await buildJpeg(), 'cover1.jpg')
          .expect(200),
      );
      const firstKey = first.coverImageUrl!.replace(
        'https://fake-r2.test/',
        '',
      );

      const second = await bodyOf<GroupResponseDto>(
        request(app.getHttpServer())
          .put(`/api/v1/groups/${group.id}/cover-image`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .attach('file', await buildPng(), 'cover2.png')
          .expect(200),
      );
      const secondKey = second.coverImageUrl!.replace(
        'https://fake-r2.test/',
        '',
      );
      expect(fakeR2Storage.objects.has(firstKey)).toBe(false);
      expect(fakeR2Storage.objects.has(secondKey)).toBe(true);

      const deleted = await bodyOf<GroupResponseDto>(
        request(app.getHttpServer())
          .delete(`/api/v1/groups/${group.id}/cover-image`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .expect(200),
      );

      expect(fakeR2Storage.objects.has(secondKey)).toBe(false);
      expect(deleted.coverImageUrl).toBeNull();
    });

    it('denies a caller with no Role Assignment at all on the Group (404, never 403)', async () => {
      const group = await createGroup();

      const res = await request(app.getHttpServer())
        .put(`/api/v1/groups/${group.id}/cover-image`)
        .set('Authorization', `Bearer ${OUTSIDER_TOKEN}`)
        .attach('file', await buildJpeg(), 'cover.jpg')
        .expect(404);

      expect((res.body as HttpErrorResponse).code).toBe('GROUP_NOT_FOUND');
    });
  });

  // ─── Section profile image ─────────────────────────────────────────────

  describe('Section profile-image (PUT/DELETE /sections/:id/profile-image)', () => {
    it('uploads a profile image, clearing the legacy logoUrl', async () => {
      const section = await createSection();

      const dto = await bodyOf<SectionResponseDto>(
        request(app.getHttpServer())
          .put(`/api/v1/sections/${section.id}/profile-image`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .attach('file', await buildJpeg(), 'logo.jpg')
          .expect(200),
      );

      expect(dto.logoUrl).toMatch(
        /^https:\/\/fake-r2\.test\/sections\/.+\/profile\/.+\.webp$/,
      );
    });

    it('deletes the profile image without restoring the legacy logoUrl', async () => {
      const section = await createSection();
      await request(app.getHttpServer())
        .put(`/api/v1/sections/${section.id}/profile-image`)
        .set('Authorization', `Bearer ${OWNER_TOKEN}`)
        .attach('file', await buildJpeg(), 'logo.jpg')
        .expect(200);

      const deleted = await bodyOf<SectionResponseDto>(
        request(app.getHttpServer())
          .delete(`/api/v1/sections/${section.id}/profile-image`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .expect(200),
      );

      expect(deleted.logoUrl).toBeNull();
    });

    it('denies a caller with no Role Assignment at all on the Section (404, never 403)', async () => {
      const section = await createSection();

      const res = await request(app.getHttpServer())
        .put(`/api/v1/sections/${section.id}/profile-image`)
        .set('Authorization', `Bearer ${OUTSIDER_TOKEN}`)
        .attach('file', await buildJpeg(), 'logo.jpg')
        .expect(404);

      expect((res.body as HttpErrorResponse).code).toBe('GROUP_NOT_FOUND');
    });
  });

  // ─── Section cover image ────────────────────────────────────────────────
  // Section's own cover-image feature (module: "zbuduj pełne tło sekcji od
  // zera") - mirrors Group cover-image above exactly, same endpoint shape/
  // gating, just mounted under /sections/:sectionId.

  describe('Section cover-image (PUT/DELETE /sections/:id/cover-image)', () => {
    it('uploads a 1600x900 cover, clearing the legacy coverImageUrl', async () => {
      const section = await createSection();

      const dto = await bodyOf<SectionResponseDto>(
        request(app.getHttpServer())
          .put(`/api/v1/sections/${section.id}/cover-image`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .attach('file', await buildJpeg(), 'cover.jpg')
          .expect(200),
      );

      expect(dto.coverImageUrl).toMatch(
        /^https:\/\/fake-r2\.test\/sections\/.+\/cover\/.+\.webp$/,
      );
    });

    it('replace then delete: the old object is physically removed each time, and delete never restores the pre-upload legacy coverImageUrl', async () => {
      const section = await createSection();

      const first = await bodyOf<SectionResponseDto>(
        request(app.getHttpServer())
          .put(`/api/v1/sections/${section.id}/cover-image`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .attach('file', await buildJpeg(), 'cover1.jpg')
          .expect(200),
      );
      const firstKey = first.coverImageUrl!.replace(
        'https://fake-r2.test/',
        '',
      );

      const second = await bodyOf<SectionResponseDto>(
        request(app.getHttpServer())
          .put(`/api/v1/sections/${section.id}/cover-image`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .attach('file', await buildPng(), 'cover2.png')
          .expect(200),
      );
      const secondKey = second.coverImageUrl!.replace(
        'https://fake-r2.test/',
        '',
      );
      expect(fakeR2Storage.objects.has(firstKey)).toBe(false);
      expect(fakeR2Storage.objects.has(secondKey)).toBe(true);

      const deleted = await bodyOf<SectionResponseDto>(
        request(app.getHttpServer())
          .delete(`/api/v1/sections/${section.id}/cover-image`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .expect(200),
      );

      expect(fakeR2Storage.objects.has(secondKey)).toBe(false);
      expect(deleted.coverImageUrl).toBeNull();
    });

    it('denies a caller with no Role Assignment at all on the Section (404, never 403)', async () => {
      const section = await createSection();

      const res = await request(app.getHttpServer())
        .put(`/api/v1/sections/${section.id}/cover-image`)
        .set('Authorization', `Bearer ${OUTSIDER_TOKEN}`)
        .attach('file', await buildJpeg(), 'cover.jpg')
        .expect(404);

      expect((res.body as HttpErrorResponse).code).toBe('GROUP_NOT_FOUND');
    });
  });

  // ─── Event cover image ──────────────────────────────────────────────────

  describe('Event cover-image (PUT/DELETE /events/:eventId/cover-image)', () => {
    it('uploads a 1600x900 cover, clearing the legacy coverImageUrl', async () => {
      const event = await createPersonalEvent();

      const dto = await bodyOf<EventResponseDto>(
        request(app.getHttpServer())
          .put(`/api/v1/events/${event.id}/cover-image`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .attach('file', await buildJpeg(), 'cover.jpg')
          .expect(200),
      );

      expect(dto.coverImageUrl).toMatch(
        /^https:\/\/fake-r2\.test\/events\/.+\/cover\/.+\.webp$/,
      );
      const key = dto.coverImageUrl!.replace('https://fake-r2.test/', '');
      const stored = fakeR2Storage.objects.get(key)!;
      const metadata = await sharp(stored).metadata();
      expect(metadata.width).toBe(1600);
      expect(metadata.height).toBe(900);
    });

    it('replace then delete: the old object is physically removed, delete never restores the legacy coverImageUrl', async () => {
      const event = await createPersonalEvent();

      const first = await bodyOf<EventResponseDto>(
        request(app.getHttpServer())
          .put(`/api/v1/events/${event.id}/cover-image`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .attach('file', await buildJpeg(), 'cover1.jpg')
          .expect(200),
      );
      const firstKey = first.coverImageUrl!.replace(
        'https://fake-r2.test/',
        '',
      );

      const second = await bodyOf<EventResponseDto>(
        request(app.getHttpServer())
          .put(`/api/v1/events/${event.id}/cover-image`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .attach('file', await buildPng(), 'cover2.png')
          .expect(200),
      );
      expect(fakeR2Storage.objects.has(firstKey)).toBe(false);

      const deleted = await bodyOf<EventResponseDto>(
        request(app.getHttpServer())
          .delete(`/api/v1/events/${event.id}/cover-image`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .expect(200),
      );

      expect(deleted.coverImageUrl).toBeNull();
      const secondKey = second.coverImageUrl!.replace(
        'https://fake-r2.test/',
        '',
      );
      expect(fakeR2Storage.objects.has(secondKey)).toBe(false);
    });

    it('denies a caller with no Event role at all (404, never 403)', async () => {
      const event = await createPersonalEvent();

      const res = await request(app.getHttpServer())
        .put(`/api/v1/events/${event.id}/cover-image`)
        .set('Authorization', `Bearer ${OUTSIDER_TOKEN}`)
        .attach('file', await buildJpeg(), 'cover.jpg')
        .expect(404);

      expect((res.body as HttpErrorResponse).code).toBe('EVENT_NOT_FOUND');
    });

    it('blocks changing the cover once the Event is ARCHIVED - canEdit=false, not re-implemented against a role', async () => {
      const event = await createPersonalEvent();
      await request(app.getHttpServer())
        .post(`/api/v1/events/${event.id}/publish`)
        .set('Authorization', `Bearer ${OWNER_TOKEN}`)
        .expect(201);
      await request(app.getHttpServer())
        .post(`/api/v1/events/${event.id}/cancel`)
        .set('Authorization', `Bearer ${OWNER_TOKEN}`)
        .send({ reason: null })
        .expect(201);
      await request(app.getHttpServer())
        .post(`/api/v1/events/${event.id}/archive`)
        .set('Authorization', `Bearer ${OWNER_TOKEN}`)
        .expect(201);

      const res = await request(app.getHttpServer())
        .put(`/api/v1/events/${event.id}/cover-image`)
        .set('Authorization', `Bearer ${OWNER_TOKEN}`)
        .attach('file', await buildJpeg(), 'cover.jpg')
        .expect(409);

      expect((res.body as HttpErrorResponse).code).toBe('EVENT_ARCHIVED');

      const deleteRes = await request(app.getHttpServer())
        .delete(`/api/v1/events/${event.id}/cover-image`)
        .set('Authorization', `Bearer ${OWNER_TOKEN}`)
        .expect(409);

      expect((deleteRes.body as HttpErrorResponse).code).toBe('EVENT_ARCHIVED');
    });
  });
});
