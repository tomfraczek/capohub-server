import {
  INestApplication,
  UnauthorizedException,
  VersioningType,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { EntityManager } from '@mikro-orm/postgresql';
import request from 'supertest';
import { App } from 'supertest/types';
import { randomUUID } from 'node:crypto';
import { AppModule } from '../src/app.module';
import { ClerkAuthService } from '../src/auth/clerk/clerk-auth.service';
import { CLERK_CLIENT } from '../src/auth/clerk/clerk-client.provider';
import { AuthContext } from '../src/auth/types/auth-context.type';
import { AppConfigService } from '../src/config/app.config';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';
import { PaginatedResponse } from '../src/common/pagination/pagination.types';
import { generatePublicCode } from '../src/common/utils/public-code';
import { Section } from '../src/groups/entities/section.entity';
import { SectionMembership } from '../src/groups/entities/section-membership.entity';
import { RoleAssignment } from '../src/groups/entities/role-assignment.entity';
import { GroupRole } from '../src/groups/enums/group-role.enum';
import { GroupStatus } from '../src/groups/enums/group-status.enum';
import { SectionMembershipStatus } from '../src/groups/enums/section-membership-status.enum';
import { RoleAssignmentsService } from '../src/groups/role-assignments.service';
import { closeE2eApp } from './close-e2e-app.helper';
import { User } from '../src/users/entities/user.entity';
import {
  MetronomeSequenceResponseDto,
  MetronomeSequenceSectionDto,
  SectionMetronomeSequenceResponseDto,
} from '../src/metronome-sequences/dto/metronome-sequence-response.dto';
import { MetronomeSequence } from '../src/metronome-sequences/entities/metronome-sequence.entity';

// Who is who in two Sections:
//   author   - OWNER of "Capoeira Poznań" (A) and of section B
//   admin    - ADMIN of A
//   member   - plain MEMBER of A
//   reader   - MEMBER of A whose membership is READ_ONLY (suspended)
//   former   - MEMBER of A whose membership ended (ARCHIVED)
//   outsider - no membership anywhere
const USERS = [
  'author',
  'admin',
  'member',
  'reader',
  'former',
  'outsider',
] as const;
type TestUser = (typeof USERS)[number];

const token = (user: TestUser) => `valid-metronome-${user}-token`;
const clerkId = (user: TestUser) => `user_test_metronome_${user}`;

const TOKEN_TO_AUTH: Record<string, AuthContext> = Object.fromEntries(
  USERS.map((user) => [
    token(user),
    {
      userId: clerkId(user),
      sessionId: `sess_metronome_${user}`,
      tokenType: 'session_token',
      claims: { sub: clerkId(user), sid: `sess_metronome_${user}` },
    },
  ]),
);

const FIXTURE_CLERK_PROFILES: Record<
  string,
  { imageUrl: string; primaryEmailAddress: { emailAddress: string } | null }
> = Object.fromEntries(
  USERS.map((user) => [
    clerkId(user),
    {
      imageUrl: `https://img.clerk.com/metronome-${user}.png`,
      primaryEmailAddress: { emailAddress: `metronome.${user}@example.com` },
    },
  ]),
);

const TEST_CLERK_USER_IDS = USERS.map(clerkId);

const fixtureClerkAuthService = {
  verifySessionToken: (sessionToken: string) => {
    const auth = TOKEN_TO_AUTH[sessionToken];
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

const rests = (count: number) =>
  Array.from({ length: count }, () => ({ sound: 'rest', muted: false }));

// "Atabaque – podstawowy": open - slap - [bass on 2&] - open - rest, at
// division 8, on the 16-step fine grid.
function atabaqueSteps(): { sound: string; muted: boolean }[] {
  const steps = rests(16);
  steps[0] = { sound: 'open', muted: false };
  steps[4] = { sound: 'slap', muted: false };
  steps[6] = { sound: 'bass', muted: false };
  steps[8] = { sound: 'open', muted: false };
  return steps;
}

function sequenceBody(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    title: 'Atabaque – podstawowy',
    instrument: 'atabaque',
    bpm: 132,
    division: 8,
    steps: atabaqueSteps(),
    ...overrides,
  };
}

describe('Metronome sequences (e2e)', () => {
  let app: INestApplication<App>;
  let em: EntityManager;
  const userIds = {} as Record<TestUser, string>;
  let sectionA: Section;
  let sectionB: Section;

  const server = () => app.getHttpServer();
  const as = (user: TestUser) => `Bearer ${token(user)}`;

  async function buildSection(name: string): Promise<Section> {
    const section = new Section();
    section.name = `${name} ${randomUUID().slice(0, 6)}`;
    section.publicCode = generatePublicCode();
    section.parentGroup = null;
    section.isPublic = true;
    section.isHidden = false;
    section.memberInvitesAllowed = false;
    section.status = GroupStatus.ACTIVE;
    section.timezone = 'Europe/Warsaw';
    section.currencyCode = 'PLN';
    await em.persist(section).flush();
    return section;
  }

  // The same rows SectionsService/SectionMembershipsService create: a
  // membership plus MEMBER (and any higher Role) assignments.
  async function join(
    section: Section,
    user: TestUser,
    roles: GroupRole[],
    status = SectionMembershipStatus.ACTIVE,
  ): Promise<void> {
    const roleAssignments = app.get(RoleAssignmentsService);
    await em.transactional(async (tx) => {
      const member = await tx.findOneOrFail(User, { id: userIds[user] });
      const target = await tx.findOneOrFail(Section, { id: section.id });
      const membership = new SectionMembership();
      membership.section = target;
      membership.user = member;
      membership.status = status;
      if (status === SectionMembershipStatus.ARCHIVED) {
        membership.leftAt = new Date();
      }
      tx.persist(membership);
      for (const role of [GroupRole.MEMBER, ...roles]) {
        await roleAssignments.insertRoleAssignment(
          tx,
          member,
          target,
          role,
          member,
        );
      }
      await tx.flush();
    });
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(ClerkAuthService)
      .useValue(fixtureClerkAuthService)
      .overrideProvider(CLERK_CLIENT)
      .useValue(fixtureClerkClient)
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
    em = app.get(EntityManager).fork();

    // The first authenticated request creates each local User.
    for (const user of USERS) {
      await request(server())
        .get('/api/v1/metronome-sequences/mine')
        .set('Authorization', as(user))
        .expect(200);
      userIds[user] = (
        await em.findOneOrFail(User, { clerkUserId: clerkId(user) })
      ).id;
    }

    sectionA = await buildSection('Capoeira Poznań');
    sectionB = await buildSection('Sekcja B');
    await join(sectionA, 'author', [GroupRole.OWNER]);
    await join(sectionB, 'author', [GroupRole.OWNER]);
    await join(sectionA, 'admin', [GroupRole.ADMIN]);
    await join(sectionA, 'member', []);
    await join(sectionA, 'reader', [], SectionMembershipStatus.READ_ONLY);
    await join(sectionA, 'former', [], SectionMembershipStatus.ARCHIVED);
  });

  afterEach(async () => {
    await em.fork().nativeDelete(MetronomeSequence, {
      owner: { $in: Object.values(userIds) },
    });
  });

  afterAll(async () => {
    await closeE2eApp(app, async () => {
      const cleanup = app.get(EntityManager).fork();
      const sectionIds = [sectionA?.id, sectionB?.id].filter(Boolean);
      await cleanup.nativeDelete(RoleAssignment, {
        section: { $in: sectionIds },
      });
      await cleanup.nativeDelete(SectionMembership, {
        section: { $in: sectionIds },
      });
      await cleanup.nativeDelete(Section, { id: { $in: sectionIds } });
      await cleanup.nativeDelete(User, {
        clerkUserId: { $in: TEST_CLERK_USER_IDS },
      });
    });
  });

  // --- helpers ------------------------------------------------------------

  const put = (user: TestUser, id: string, body: Record<string, unknown>) =>
    request(server())
      .put(`/api/v1/metronome-sequences/${id}`)
      .set('Authorization', as(user))
      .send(body);

  async function createSequence(
    user: TestUser,
    overrides: Record<string, unknown> = {},
  ): Promise<string> {
    const id = randomUUID();
    await put(user, id, sequenceBody(overrides)).expect(201);
    return id;
  }

  const mine = async (user: TestUser) =>
    (
      await request(server())
        .get('/api/v1/metronome-sequences/mine')
        .set('Authorization', as(user))
        .expect(200)
    ).body as MetronomeSequenceResponseDto[];

  const share = (user: TestUser, id: string, sectionIds: string[]) =>
    request(server())
      .put(`/api/v1/metronome-sequences/${id}/sections`)
      .set('Authorization', as(user))
      .send({ sectionIds });

  const sectionList = (user: TestUser, sectionId: string) =>
    request(server())
      .get(`/api/v1/sections/${sectionId}/metronome-sequences`)
      .query({ page: 1, limit: 100 })
      .set('Authorization', as(user));

  const sectionItems = async (user: TestUser, sectionId: string) =>
    (
      (await sectionList(user, sectionId).expect(200))
        .body as PaginatedResponse<SectionMetronomeSequenceResponseDto>
    ).data;

  const copy = (user: TestUser, sectionId: string, id: string) =>
    request(server())
      .post(`/api/v1/sections/${sectionId}/metronome-sequences/${id}/copies`)
      .set('Authorization', as(user));

  const removeFromSection = (user: TestUser, sectionId: string, id: string) =>
    request(server())
      .delete(`/api/v1/sections/${sectionId}/metronome-sequences/${id}`)
      .set('Authorization', as(user));

  const addToSection = (user: TestUser, sectionId: string, ids: string[]) =>
    request(server())
      .post(`/api/v1/sections/${sectionId}/metronome-sequences`)
      .set('Authorization', as(user))
      .send({ sequenceIds: ids });

  // --- own sequences ------------------------------------------------------

  describe('own sequences', () => {
    it('creates a sequence under the id the app chose, then replaces it on a repeated save', async () => {
      const id = randomUUID();
      const created = (await put('author', id, sequenceBody()).expect(201))
        .body as MetronomeSequenceResponseDto;

      expect(created).toMatchObject({
        id,
        title: 'Atabaque – podstawowy',
        instrument: 'atabaque',
        bpm: 132,
        division: 8,
        steps: atabaqueSteps(),
        sharedInSections: [],
        originalAuthor: null,
      });
      expect(created).not.toHaveProperty('visibility');

      await put('author', id, sequenceBody({ bpm: 90 })).expect(200);
      const list = await mine('author');
      expect(list).toHaveLength(1);
      expect(list[0].bpm).toBe(90);
    });

    it('still accepts the retired `visibility` field from an older app', async () => {
      await put(
        'author',
        randomUUID(),
        sequenceBody({ visibility: 'public' }),
      ).expect(201);
    });

    it.each([
      ['an unknown instrument', { instrument: 'berimbau' }],
      [
        "another instrument's sound",
        {
          instrument: 'agogo',
          steps: [{ sound: 'slap', muted: false }, ...rests(15)],
        },
      ],
      ['a short step list', { steps: rests(15) }],
      ['a tempo out of range', { bpm: 300 }],
      ['an unknown division', { division: 5 }],
      ['an empty title', { title: '   ' }],
    ])('rejects %s', async (_, override) => {
      await put('author', randomUUID(), sequenceBody(override)).expect(400);
    });

    it("never touches another user's sequence through its id", async () => {
      const id = await createSequence('author');

      await put('member', id, sequenceBody({ title: 'Przejęta' })).expect(409);
      await request(server())
        .delete(`/api/v1/metronome-sequences/${id}`)
        .set('Authorization', as('member'))
        .expect(404);
      expect((await mine('author'))[0].title).toBe('Atabaque – podstawowy');
    });

    it('requires a signed-in user', async () => {
      await request(server())
        .get('/api/v1/metronome-sequences/mine')
        .expect(401);
      await request(server())
        .get(`/api/v1/sections/${sectionA.id}/metronome-sequences`)
        .expect(401);
    });

    it('no longer has a global public library', async () => {
      const res = await request(server())
        .get('/api/v1/metronome-sequences/public')
        .set('Authorization', as('member'));

      expect([400, 404]).toContain(res.status);
    });
  });

  // --- where one may share -----------------------------------------------

  describe('shareable sections', () => {
    const shareable = async (user: TestUser) =>
      (
        await request(server())
          .get('/api/v1/metronome-sequences/shareable-sections')
          .set('Authorization', as(user))
          .expect(200)
      ).body as MetronomeSequenceSectionDto[];

    it('lists the sections the user owns or administers', async () => {
      expect((await shareable('author')).map((item) => item.id).sort()).toEqual(
        [sectionA.id, sectionB.id].sort(),
      );
      expect(await shareable('admin')).toEqual([
        { id: sectionA.id, name: sectionA.name },
      ]);
    });

    it('is empty for plain, suspended, former members and outsiders', async () => {
      for (const user of ['member', 'reader', 'former', 'outsider'] as const) {
        expect(await shareable(user)).toEqual([]);
      }
    });
  });

  // --- sharing ------------------------------------------------------------

  describe('sharing in sections', () => {
    it('shares in one section - members see it there', async () => {
      const id = await createSequence('author');

      const shared = (await share('author', id, [sectionA.id]).expect(200))
        .body as MetronomeSequenceSectionDto[];
      expect(shared).toEqual([{ id: sectionA.id, name: sectionA.name }]);
      expect((await mine('author'))[0].sharedInSections).toEqual(shared);

      const asMember = await sectionItems('member', sectionA.id);
      expect(asMember).toHaveLength(1);
      expect(asMember[0]).toMatchObject({
        id,
        title: 'Atabaque – podstawowy',
        instrument: 'atabaque',
        bpm: 132,
        division: 8,
        steps: atabaqueSteps(),
        isOwn: false,
        canRemove: false,
      });
      expect(asMember[0].author.displayName).toBeTruthy();
      expect(JSON.stringify(asMember[0])).not.toContain('@example.com');

      expect((await sectionItems('admin', sectionA.id))[0].canRemove).toBe(
        true,
      );
      expect((await sectionItems('author', sectionA.id))[0]).toMatchObject({
        isOwn: true,
        canRemove: true,
      });
      // A suspended (READ_ONLY) member still sees the library.
      expect(await sectionItems('reader', sectionA.id)).toHaveLength(1);
    });

    it('shares one sequence in several sections independently, without copies', async () => {
      const id = await createSequence('author');
      await share('author', id, [sectionA.id, sectionB.id]).expect(200);

      expect((await sectionItems('author', sectionA.id))[0].id).toBe(id);
      expect((await sectionItems('author', sectionB.id))[0].id).toBe(id);
      expect(await mine('author')).toHaveLength(1);

      // Withdrawing from one section leaves the other.
      await share('author', id, [sectionB.id]).expect(200);
      expect(await sectionItems('member', sectionA.id)).toEqual([]);
      expect(await sectionItems('author', sectionB.id)).toHaveLength(1);
    });

    it('is idempotent - sharing again never duplicates', async () => {
      const id = await createSequence('author');
      await Promise.all([
        share('author', id, [sectionA.id]),
        share('author', id, [sectionA.id]),
      ]);
      await share('author', id, [sectionA.id, sectionA.id]).expect(200);

      expect(await sectionItems('member', sectionA.id)).toHaveLength(1);
    });

    it('lets an admin share their own sequence', async () => {
      const id = await createSequence('admin');
      await share('admin', id, [sectionA.id]).expect(200);

      expect((await sectionItems('member', sectionA.id))[0].id).toBe(id);
    });

    it('refuses sharing without the right to manage the section', async () => {
      const memberSequence = await createSequence('member');
      await share('member', memberSequence, [sectionA.id]).expect(403);

      const adminSequence = await createSequence('admin');
      await share('admin', adminSequence, [sectionB.id]).expect(403);

      const outsiderSequence = await createSequence('outsider');
      await share('outsider', outsiderSequence, [sectionA.id]).expect(403);
      await share('outsider', outsiderSequence, [randomUUID()]).expect(403);

      expect(await sectionItems('author', sectionA.id)).toEqual([]);
    });

    it("refuses sharing someone else's sequence", async () => {
      const id = await createSequence('admin');

      await share('author', id, [sectionA.id]).expect(404);
    });
  });

  // --- visibility ---------------------------------------------------------

  describe('who sees a section library', () => {
    it('hides it from outsiders and former members, even through the API', async () => {
      const id = await createSequence('author');
      await share('author', id, [sectionA.id]).expect(200);

      for (const user of ['outsider', 'former'] as const) {
        await sectionList(user, sectionA.id).expect(404);
        await copy(user, sectionA.id, id).expect(404);
      }
    });

    it("hides another section's library from members of this one", async () => {
      const id = await createSequence('author');
      await share('author', id, [sectionB.id]).expect(200);

      await sectionList('member', sectionB.id).expect(404);
      // ...and a sequence not shared here can't be copied through here.
      await copy('member', sectionA.id, id).expect(404);
    });

    it('keeps private sequences private', async () => {
      await createSequence('author');

      expect(await sectionItems('member', sectionA.id)).toEqual([]);
    });
  });

  // --- "Zapisz u siebie" --------------------------------------------------

  describe('"Zapisz u siebie"', () => {
    async function sharedInA(): Promise<string> {
      const id = await createSequence('author');
      await share('author', id, [sectionA.id]).expect(200);
      return id;
    }

    it('saves an independent private copy credited to the author', async () => {
      const sourceId = await sharedInA();
      const copied = (await copy('member', sectionA.id, sourceId).expect(201))
        .body as MetronomeSequenceResponseDto;

      expect(copied.id).not.toBe(sourceId);
      expect(copied).toMatchObject({
        title: 'Atabaque – podstawowy',
        instrument: 'atabaque',
        bpm: 132,
        division: 8,
        steps: atabaqueSteps(),
        sharedInSections: [],
      });
      expect(copied.originalAuthor?.displayName).toBeTruthy();
      expect((await mine('member')).map((item) => item.id)).toEqual([
        copied.id,
      ]);
      // Copying is reading, so a suspended member may do it too.
      await copy('reader', sectionA.id, sourceId).expect(201);
    });

    it('keeps copy and original independent both ways', async () => {
      const sourceId = await sharedInA();
      const copied = (await copy('member', sectionA.id, sourceId).expect(201))
        .body as MetronomeSequenceResponseDto;

      await put(
        'member',
        copied.id,
        sequenceBody({ bpm: 70, title: 'Moja wersja' }),
      ).expect(200);
      expect((await mine('author'))[0]).toMatchObject({
        bpm: 132,
        title: 'Atabaque – podstawowy',
      });

      await put(
        'author',
        sourceId,
        sequenceBody({ bpm: 150, title: 'Szybciej' }),
      ).expect(200);
      expect((await mine('member'))[0]).toMatchObject({
        bpm: 70,
        title: 'Moja wersja',
      });
    });

    it('returns the existing copy instead of a duplicate, even for simultaneous taps', async () => {
      const sourceId = await sharedInA();
      const responses = await Promise.all([
        copy('member', sectionA.id, sourceId),
        copy('member', sectionA.id, sourceId),
        copy('member', sectionA.id, sourceId),
      ]);

      expect(responses.map((res) => res.status).sort()).toEqual([
        200, 200, 201,
      ]);
      const ids = responses.map(
        (res) => (res.body as MetronomeSequenceResponseDto).id,
      );
      expect(new Set(ids).size).toBe(1);
      expect(await mine('member')).toHaveLength(1);
    });
  });

  // --- removing -----------------------------------------------------------

  describe('removing from a section', () => {
    it('lets a section admin remove a sequence shared by the owner - only the link goes', async () => {
      const sourceId = await createSequence('author');
      await share('author', sourceId, [sectionA.id]).expect(200);
      const copied = (await copy('member', sectionA.id, sourceId).expect(201))
        .body as MetronomeSequenceResponseDto;

      await removeFromSection('member', sectionA.id, sourceId).expect(403);
      await removeFromSection('admin', sectionA.id, sourceId).expect(204);
      await removeFromSection('admin', sectionA.id, sourceId).expect(404);

      expect(await sectionItems('member', sectionA.id)).toEqual([]);
      expect((await mine('author'))[0]).toMatchObject({
        id: sourceId,
        sharedInSections: [],
      });
      expect((await mine('member')).map((item) => item.id)).toEqual([
        copied.id,
      ]);
    });

    it('lets the author withdraw every share', async () => {
      const id = await createSequence('author');
      await share('author', id, [sectionA.id, sectionB.id]).expect(200);

      expect((await share('author', id, []).expect(200)).body).toEqual([]);
      expect(await sectionItems('author', sectionA.id)).toEqual([]);
      expect(await sectionItems('author', sectionB.id)).toEqual([]);
    });

    it("drops the shares when the author deletes the sequence, keeping members' copies", async () => {
      const sourceId = await createSequence('author');
      await share('author', sourceId, [sectionA.id]).expect(200);
      const copied = (await copy('member', sectionA.id, sourceId).expect(201))
        .body as MetronomeSequenceResponseDto;

      await request(server())
        .delete(`/api/v1/metronome-sequences/${sourceId}`)
        .set('Authorization', as('author'))
        .expect(204);

      expect(await sectionItems('member', sectionA.id)).toEqual([]);
      expect((await mine('member'))[0]).toMatchObject({
        id: copied.id,
        bpm: 132,
        steps: atabaqueSteps(),
      });
    });
  });

  // --- "Dodaj sekwencję" from the section --------------------------------

  describe('adding from the section', () => {
    it('adds one or several own sequences - links, not copies', async () => {
      const one = await createSequence('author');
      const two = await createSequence('author', {
        instrument: 'agogo',
        title: 'Agogô – trening',
        division: 4,
        steps: [
          { sound: 'low', muted: false },
          ...rests(3),
          { sound: 'high', muted: false },
          ...rests(11),
        ],
      });

      const res = await addToSection('author', sectionA.id, [one, two]).expect(
        200,
      );
      expect(
        (res.body as { addedSequenceIds: string[] }).addedSequenceIds.sort(),
      ).toEqual([one, two].sort());

      const items = await sectionItems('member', sectionA.id);
      expect(items.map((item) => item.id).sort()).toEqual([one, two].sort());
      expect(await mine('author')).toHaveLength(2);
      expect(
        (await mine('author')).every((item) =>
          item.sharedInSections.some((section) => section.id === sectionA.id),
        ),
      ).toBe(true);
    });

    it('never duplicates - adding again, or both ways, keeps one link', async () => {
      const id = await createSequence('author');
      await share('author', id, [sectionA.id]).expect(200);

      const res = await addToSection('author', sectionA.id, [id, id]).expect(
        200,
      );
      expect(
        (res.body as { addedSequenceIds: string[] }).addedSequenceIds,
      ).toEqual([]);
      expect(await sectionItems('member', sectionA.id)).toHaveLength(1);
    });

    it('keeps the sequence shared in other sections', async () => {
      const id = await createSequence('author');
      await share('author', id, [sectionB.id]).expect(200);

      await addToSection('author', sectionA.id, [id]).expect(200);

      expect(
        (await mine('author'))[0].sharedInSections.map((section) => section.id),
      ).toEqual(expect.arrayContaining([sectionA.id, sectionB.id]));
      expect(await sectionItems('author', sectionB.id)).toHaveLength(1);
    });

    it("refuses someone else's sequence - and adds nothing from that request", async () => {
      const own = await createSequence('author');
      const foreign = await createSequence('admin');

      await addToSection('author', sectionA.id, [own, foreign]).expect(404);
      await addToSection('author', sectionA.id, [randomUUID()]).expect(404);
      expect(await sectionItems('member', sectionA.id)).toEqual([]);
    });

    it('is only for the section owner and admins', async () => {
      const memberSequence = await createSequence('member');
      const readerSequence = await createSequence('reader');
      const outsiderSequence = await createSequence('outsider');

      await addToSection('member', sectionA.id, [memberSequence]).expect(403);
      await addToSection('reader', sectionA.id, [readerSequence]).expect(403);
      await addToSection('outsider', sectionA.id, [outsiderSequence]).expect(
        404,
      );

      const adminSequence = await createSequence('admin');
      await addToSection('admin', sectionA.id, [adminSequence]).expect(200);
      // ...but an admin of A can't add to B.
      await addToSection('admin', sectionB.id, [adminSequence]).expect(404);
    });

    it('stays consistent under simultaneous changes', async () => {
      const one = await createSequence('author');
      const two = await createSequence('author', { bpm: 100 });

      await Promise.all([
        addToSection('author', sectionA.id, [one, two]),
        addToSection('author', sectionA.id, [two, one]),
        addToSection('author', sectionB.id, [one]),
        share('author', two, [sectionA.id, sectionB.id]),
      ]);

      expect(
        (await sectionItems('member', sectionA.id))
          .map((item) => item.id)
          .sort(),
      ).toEqual([one, two].sort());
      expect(
        (await sectionItems('author', sectionB.id))
          .map((item) => item.id)
          .sort(),
      ).toEqual([one, two].sort());
    });
  });
});
