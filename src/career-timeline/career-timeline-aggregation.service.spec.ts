import type { EntityManager } from '@mikro-orm/postgresql';
import { EventAccessService } from '../events/event-access.service';
import { Event } from '../events/entities/event.entity';
import { EventVisibility } from '../events/enums/event-visibility.enum';
import { FormalRankCorrectionService } from '../graduation/formal-rank-correction.service';
import { FormalRankAssignment } from '../graduation/entities/formal-rank-assignment.entity';
import { CustomUserRank } from '../graduation/entities/custom-user-rank.entity';
import { Rank } from '../graduation/entities/rank.entity';
import { RankTrack } from '../graduation/enums/rank-track.enum';
import { Collection } from '@mikro-orm/core';
import { FormalGroupAffiliation } from '../groups/entities/formal-group-affiliation.entity';
import { Group } from '../groups/entities/group.entity';
import { GroupRole } from '../groups/enums/group-role.enum';
import { RoleAssignment } from '../groups/entities/role-assignment.entity';
import { Section } from '../groups/entities/section.entity';
import { R2StorageService } from '../storage/r2-storage.service';
import { User } from '../users/entities/user.entity';
import { CareerTimelineAggregationService } from './career-timeline-aggregation.service';
import { CareerTimelineEntry } from './entities/career-timeline-entry.entity';
import {
  CareerTimelineEntryType,
  CareerTimelinePrecision,
} from './enums/career-timeline-entry-type.enum';

function buildUser(overrides: Partial<User> = {}): User {
  const user = new User();
  user.id = 'user-1';
  user.email = 'ada@example.com';
  user.capoeiraStartedAt = null;
  user.showCapoeiraStartedAt = false;
  user.showFormalGroup = false;
  user.showFormalRank = false;
  user.showCareerTimeline = false;
  Object.assign(user, overrides);
  return user;
}

function buildGroup(
  id = 'group-1',
  name = 'Cordao de Ouro',
  overrides: Partial<Group> = {},
): Group {
  const group = new Group();
  group.id = id;
  group.name = name;
  group.founderUser = null;
  return Object.assign(group, overrides);
}

function buildSection(
  id = 'section-1',
  name = 'Seção Centro',
  overrides: Partial<Section> = {},
): Section {
  const section = new Section();
  section.id = id;
  section.name = name;
  section.city = null;
  section.parentGroup = null;
  section.founderUser = null;
  return Object.assign(section, overrides);
}

function buildRank(overrides: Partial<Rank> = {}): Rank {
  const rank = new Rank();
  rank.id = 'rank-1';
  rank.name = 'Corda Verde';
  rank.track = RankTrack.ADULT;
  rank.cordSegments = new Collection<never>(rank);
  return Object.assign(rank, overrides);
}

function buildRoleAssignment(overrides: {
  id: string;
  user: User;
  role: GroupRole;
  grantedAt: Date;
  group?: Group | null;
  section?: Section | null;
}): RoleAssignment {
  const ra = new RoleAssignment();
  ra.id = overrides.id;
  ra.user = overrides.user;
  ra.role = overrides.role;
  ra.grantedAt = overrides.grantedAt;
  ra.group = overrides.group ?? null;
  ra.section = overrides.section ?? null;
  return ra;
}

interface MockRouting {
  user?: User | null;
  affiliations?: FormalGroupAffiliation[];
  assignments?: FormalRankAssignment[];
  entries?: CareerTimelineEntry[];
  roleAssignments?: RoleAssignment[];
  groups?: Group[];
  sections?: Section[];
  independentRanks?: CustomUserRank[];
}

interface RoleAssignmentWhere {
  user?: string;
  role?: GroupRole;
  group?: { $ne?: null; $in?: string[] };
  section?: { $ne?: null; $in?: string[] };
}

function matchesRoleAssignmentWhere(
  row: RoleAssignment,
  where: RoleAssignmentWhere,
): boolean {
  if (where.user !== undefined && row.user.id !== where.user) return false;
  if (where.role !== undefined && row.role !== where.role) return false;
  if (where.group !== undefined) {
    if (where.group.$ne === null && !row.group) return false;
    if (
      where.group.$in &&
      (!row.group || !where.group.$in.includes(row.group.id))
    )
      return false;
  }
  if (where.section !== undefined) {
    if (where.section.$ne === null && !row.section) return false;
    if (
      where.section.$in &&
      (!row.section || !where.section.$in.includes(row.section.id))
    )
      return false;
  }
  return true;
}

interface MockFindWhere extends RoleAssignmentWhere {
  type?: { $in?: string[] };
  founderUser?: string;
}

function buildMockEm(routing: MockRouting = {}) {
  const find = jest.fn((entityClass: unknown, where: MockFindWhere = {}) => {
    if (entityClass === FormalGroupAffiliation) {
      return Promise.resolve(routing.affiliations ?? []);
    }
    if (entityClass === FormalRankAssignment) {
      return Promise.resolve(routing.assignments ?? []);
    }
    if (entityClass === CustomUserRank) {
      return Promise.resolve(routing.independentRanks ?? []);
    }
    if (entityClass === CareerTimelineEntry) {
      const entries = routing.entries ?? [];
      const allowedTypes = where.type?.$in;
      return Promise.resolve(
        allowedTypes
          ? entries.filter((entry) => allowedTypes.includes(entry.type))
          : entries,
      );
    }
    if (entityClass === RoleAssignment) {
      return Promise.resolve(
        (routing.roleAssignments ?? []).filter((row) =>
          matchesRoleAssignmentWhere(row, where),
        ),
      );
    }
    if (entityClass === Group) {
      const groups = routing.groups ?? [];
      return Promise.resolve(
        where.founderUser !== undefined
          ? groups.filter(
              (group) => group.founderUser?.id === where.founderUser,
            )
          : groups,
      );
    }
    if (entityClass === Section) {
      const sections = routing.sections ?? [];
      return Promise.resolve(
        where.founderUser !== undefined
          ? sections.filter(
              (section) => section.founderUser?.id === where.founderUser,
            )
          : sections,
      );
    }
    return Promise.resolve([]);
  });
  const findOne = jest.fn((entityClass: unknown) => {
    if (entityClass === User) {
      return Promise.resolve(routing.user === undefined ? null : routing.user);
    }
    return Promise.resolve(null);
  });
  return { find, findOne } as unknown as EntityManager;
}

function buildMockCorrectionService(
  isPubliclyVisible: (id: string) => Promise<boolean> = () =>
    Promise.resolve(true),
): { service: FormalRankCorrectionService; isPubliclyVisible: jest.Mock } {
  const mock = jest.fn(isPubliclyVisible);
  return {
    service: {
      isPubliclyVisible: mock,
    } as unknown as FormalRankCorrectionService,
    isPubliclyVisible: mock,
  };
}

function buildMockR2StorageService(): R2StorageService {
  return {
    buildPublicUrl: (key: string) => `https://cdn.example.com/${key}`,
  } as unknown as R2StorageService;
}

function buildEvent(overrides: Partial<Event> = {}): Event {
  const event = new Event();
  event.id = 'event-1';
  event.name = 'Festival Capoeira';
  event.visibility = EventVisibility.PUBLIC;
  event.locationName = 'Poznań';
  event.startsAt = new Date('2022-06-15T10:00:00.000Z');
  event.endsAt = new Date('2022-06-15T18:00:00.000Z');
  event.communityGroup = null;
  event.communitySection = null;
  return Object.assign(event, overrides);
}

function buildMockEventAccessService(
  isVisibleToViewer: () => Promise<boolean> = () => Promise.resolve(true),
): { service: EventAccessService; isVisibleToViewer: jest.Mock } {
  const mock = jest.fn(isVisibleToViewer);
  return {
    service: { isVisibleToViewer: mock } as unknown as EventAccessService,
    isVisibleToViewer: mock,
  };
}

function buildService(
  em: EntityManager,
  correctionService = buildMockCorrectionService().service,
  eventAccessService = buildMockEventAccessService().service,
) {
  return new CareerTimelineAggregationService(
    em,
    correctionService,
    buildMockR2StorageService(),
    eventAccessService,
  );
}

describe('CareerTimelineAggregationService', () => {
  describe('START_TRAINING', () => {
    it('includes an entry for the owner when capoeiraStartedAt is set', async () => {
      const user = buildUser({ capoeiraStartedAt: new Date('2015-06-01') });
      const service = buildService(buildMockEm());

      const result = await service.getTimeline(user, user.id, {
        limit: 20,
        offset: 0,
      });

      expect(result.items).toHaveLength(1);
      expect(result.items[0]).toMatchObject({
        id: 'start-training:user-1',
        type: CareerTimelineEntryType.START_TRAINING,
        origin: 'SYSTEM',
        occurredOn: '2015-06-01',
      });
    });

    it('omits the entry entirely when capoeiraStartedAt is null', async () => {
      const user = buildUser({ capoeiraStartedAt: null });
      const service = buildService(buildMockEm());

      const result = await service.getTimeline(user, user.id, {
        limit: 20,
        offset: 0,
      });

      expect(result.items).toHaveLength(0);
    });
  });

  describe('privacy gating for non-owner viewers', () => {
    it('returns an empty timeline when the target has showCareerTimeline=false', async () => {
      const viewer = buildUser({ id: 'viewer-1' });
      const target = buildUser({
        id: 'target-1',
        showCareerTimeline: false,
        capoeiraStartedAt: new Date('2015-06-01'),
        showCapoeiraStartedAt: true,
      });
      const service = buildService(buildMockEm({ user: target }));

      const result = await service.getTimeline(viewer, target.id, {
        limit: 20,
        offset: 0,
      });

      expect(result).toEqual({ items: [], total: 0, hasMore: false });
    });

    it('hides JOINED_GROUP when showFormalGroup is false, even though showCareerTimeline is true', async () => {
      const viewer = buildUser({ id: 'viewer-1' });
      const target = buildUser({
        id: 'target-1',
        showCareerTimeline: true,
        showFormalGroup: false,
      });
      const affiliation = new FormalGroupAffiliation();
      affiliation.id = 'affiliation-1';
      affiliation.group = buildGroup();
      affiliation.startedOn = new Date('2020-01-01');
      const service = buildService(
        buildMockEm({ user: target, affiliations: [affiliation] }),
      );

      const result = await service.getTimeline(viewer, target.id, {
        limit: 20,
        offset: 0,
      });

      expect(result.items).toHaveLength(0);
    });
  });

  describe('RECEIVED_RANK (SYSTEM) correction visibility', () => {
    function buildAssignment(): FormalRankAssignment {
      const assignment = new FormalRankAssignment();
      assignment.id = 'assignment-1';
      assignment.rank = buildRank();
      assignment.sourceGroup = buildGroup();
      assignment.startedOn = new Date('2022-01-01');
      assignment.event = null;
      return assignment;
    }

    it('hides a RECEIVED_RANK entry from a non-owner while a correction is active', async () => {
      const viewer = buildUser({ id: 'viewer-1' });
      const target = buildUser({
        id: 'target-1',
        showCareerTimeline: true,
        showFormalRank: true,
      });
      const em = buildMockEm({
        user: target,
        assignments: [buildAssignment()],
      });
      const service = buildService(
        em,
        buildMockCorrectionService(() => Promise.resolve(false)).service,
      );

      const result = await service.getTimeline(viewer, target.id, {
        limit: 20,
        offset: 0,
      });

      expect(result.items).toHaveLength(0);
    });

    // History keeps the real earlier rank: an ended independent stint next
    // to the rank later confirmed in a formal Group.
    it('lists a past independent rank alongside the formal rank that replaced it', async () => {
      const user = buildUser({ showFormalRank: true });
      const independent = new CustomUserRank();
      independent.id = 'custom-1';
      independent.name = 'Instrutor';
      independent.track = RankTrack.ADULT;
      independent.startedOn = new Date('2019-01-01');
      independent.endedOn = new Date('2022-01-01');
      independent.createdAt = new Date('2023-01-01T00:00:00.000Z');
      independent.cordSegments = new Collection<never>(independent);
      const em = buildMockEm({
        assignments: [buildAssignment()],
        independentRanks: [independent],
      });
      const service = buildService(em);

      const result = await service.getTimeline(user, user.id, {
        limit: 20,
        offset: 0,
      });

      const ranks = result.items.filter((item) => item.rankDetails);
      expect(ranks).toHaveLength(2);
      const independentItem = ranks.find(
        (item) => item.rankDetails?.source === 'INDEPENDENT',
      );
      expect(independentItem?.rankName).toBe('Instrutor');
      expect(independentItem?.group).toBeNull();
      expect(independentItem?.rankDetails?.rankId).toBeNull();
      expect(
        ranks.find((item) => item.rankDetails?.source === 'FORMAL_GROUP')
          ?.group,
      ).not.toBeNull();
    });

    it('always shows the RECEIVED_RANK entry to the owner, regardless of an active correction', async () => {
      const user = buildUser({ showFormalRank: true });
      const em = buildMockEm({ assignments: [buildAssignment()] });
      const { service: correctionService, isPubliclyVisible } =
        buildMockCorrectionService(() => Promise.resolve(false));
      const service = buildService(em, correctionService);

      const result = await service.getTimeline(user, user.id, {
        limit: 20,
        offset: 0,
      });

      expect(result.items).toHaveLength(1);
      expect(result.items[0].rankDetails).not.toBeNull();
      expect(isPubliclyVisible).not.toHaveBeenCalled();
    });
  });

  describe('no automatic per-Event entries', () => {
    it('never builds a timeline item from mere Event attendance - EVENT is not a standalone type any more', async () => {
      const user = buildUser({ showFormalRank: true });
      // Nothing wires EventAttendee into buildMockEm any more - the
      // aggregation service no longer queries it at all. This test's main
      // assertion is structural: requesting every type returns no item
      // whose id looks like a bare Event reference.
      const service = buildService(buildMockEm());

      const result = await service.getTimeline(user, user.id, {
        limit: 20,
        offset: 0,
      });

      expect(result.items.some((item) => item.id.startsWith('event:'))).toBe(
        false,
      );
    });
  });

  describe('STARTED_TEACHING (SYSTEM, from RoleAssignment INSTRUCTOR)', () => {
    it('builds one entry per Section the user was ever granted INSTRUCTOR on, dated by the earliest grant', async () => {
      const user = buildUser({ showFormalGroup: true });
      const section = buildSection('section-1', 'Seção Centro');
      const earlier = buildRoleAssignment({
        id: 'ra-1',
        user,
        role: GroupRole.INSTRUCTOR,
        grantedAt: new Date('2019-03-01'),
        section,
      });
      const later = buildRoleAssignment({
        id: 'ra-2',
        user,
        role: GroupRole.INSTRUCTOR,
        grantedAt: new Date('2021-01-01'),
        section,
      });
      const service = buildService(
        buildMockEm({ roleAssignments: [later, earlier] }),
      );

      const result = await service.getTimeline(user, user.id, {
        limit: 20,
        offset: 0,
      });

      const teaching = result.items.filter(
        (item) => item.type === CareerTimelineEntryType.STARTED_TEACHING,
      );
      expect(teaching).toHaveLength(1);
      expect(teaching[0]).toMatchObject({
        id: 'started-teaching:ra-1',
        occurredOn: '2019-03-01',
        origin: 'SYSTEM',
      });
    });

    it('is respected as historical even if the INSTRUCTOR role only exists as a revoked RoleAssignment row', async () => {
      const user = buildUser({ showFormalGroup: true });
      const section = buildSection();
      const revoked = buildRoleAssignment({
        id: 'ra-1',
        user,
        role: GroupRole.INSTRUCTOR,
        grantedAt: new Date('2018-01-01'),
        section,
      });
      revoked.revokedAt = new Date('2020-01-01');
      const service = buildService(buildMockEm({ roleAssignments: [revoked] }));

      const result = await service.getTimeline(user, user.id, {
        limit: 20,
        offset: 0,
      });

      expect(
        result.items.some(
          (item) => item.type === CareerTimelineEntryType.STARTED_TEACHING,
        ),
      ).toBe(true);
    });
  });

  // Follow-up fix: FOUNDED_GROUP/STARTED_SECTION used to be re-derived from
  // the earliest-ever OWNER RoleAssignment. That row can be physically
  // deleted (UserService.deleteLocalAccountData hard-deletes every
  // RoleAssignment for a deleted account), so a founder who transferred
  // ownership away and later deleted their account would silently lose
  // "founded this" to whoever the ownership went to next. Both now read
  // Group.founderUser/Section.founderUser directly - a permanent record set
  // once at creation (see GroupsService.create/SectionsService.
  // createInternal) that RoleAssignment churn can never touch.
  describe('STARTED_SECTION / FOUNDED_GROUP (from Section.founderUser / Group.founderUser)', () => {
    it('credits STARTED_SECTION to the recorded founder, dated by Section.createdAt, even after ownership has been transferred away', async () => {
      const founder = buildUser({ id: 'founder-1', showFormalGroup: true });
      const successor = buildUser({ id: 'successor-1', showFormalGroup: true });
      const section = buildSection('section-1', 'Seção Centro', {
        founderUser: founder,
        createdAt: new Date('2015-01-01'),
      });
      // Ownership has since moved to `successor` - only ever represented by
      // RoleAssignment, which STARTED_SECTION no longer reads at all.
      const successorGrant = buildRoleAssignment({
        id: 'ra-successor',
        user: successor,
        role: GroupRole.OWNER,
        grantedAt: new Date('2020-01-01'),
        section,
      });

      const founderResult = await buildService(
        buildMockEm({ sections: [section], roleAssignments: [successorGrant] }),
      ).getTimeline(founder, founder.id, { limit: 20, offset: 0 });
      const founderItems = founderResult.items.filter(
        (item) => item.type === CareerTimelineEntryType.STARTED_SECTION,
      );
      expect(founderItems).toHaveLength(1);
      expect(founderItems[0]).toMatchObject({
        id: 'started-section:section-1',
        occurredOn: '2015-01-01',
      });

      const successorResult = await buildService(
        buildMockEm({ sections: [section], roleAssignments: [successorGrant] }),
      ).getTimeline(successor, successor.id, { limit: 20, offset: 0 });
      expect(
        successorResult.items.filter(
          (item) => item.type === CareerTimelineEntryType.STARTED_SECTION,
        ),
      ).toHaveLength(0);
    });

    it('keeps crediting the true founder with STARTED_SECTION even after their own OWNER RoleAssignment has been physically deleted (transfer + account deletion)', async () => {
      const founder = buildUser({ id: 'founder-1', showFormalGroup: true });
      const section = buildSection('section-1', 'Seção Centro', {
        founderUser: founder,
        createdAt: new Date('2015-01-01'),
      });
      // Simulates the exact bug scenario: the founder's own RoleAssignment
      // row is gone (account deleted after transferring ownership away) -
      // buildMockEm's roleAssignments list is empty, only Section.founderUser
      // (never touched by transfer or account deletion) remains.
      const service = buildService(buildMockEm({ sections: [section] }));

      const result = await service.getTimeline(founder, founder.id, {
        limit: 20,
        offset: 0,
      });

      const founded = result.items.filter(
        (item) => item.type === CareerTimelineEntryType.STARTED_SECTION,
      );
      expect(founded).toHaveLength(1);
      expect(founded[0].occurredOn).toBe('2015-01-01');
    });

    it('builds FOUNDED_GROUP for the recorded founder, dated by Group.createdAt', async () => {
      const user = buildUser({ showFormalGroup: true });
      const group = buildGroup('group-1', 'Grupo Axé', {
        founderUser: user,
        createdAt: new Date('2012-01-01'),
      });
      const service = buildService(buildMockEm({ groups: [group] }));

      const result = await service.getTimeline(user, user.id, {
        limit: 20,
        offset: 0,
      });

      const founded = result.items.filter(
        (item) => item.type === CareerTimelineEntryType.FOUNDED_GROUP,
      );
      expect(founded).toHaveLength(1);
      expect(founded[0]).toMatchObject({
        id: 'founded-group:group-1',
        occurredOn: '2012-01-01',
        title: 'Założenie Grupo Axé',
      });
    });

    it('never credits FOUNDED_GROUP to a viewer who is merely the current OWNER, not the recorded founder', async () => {
      const founder = buildUser({ id: 'founder-1' });
      const currentOwner = buildUser({ id: 'owner-1', showFormalGroup: true });
      const group = buildGroup('group-1', 'Grupo Axé', {
        founderUser: founder,
      });

      const service = buildService(buildMockEm({ groups: [group] }));
      const result = await service.getTimeline(currentOwner, currentOwner.id, {
        limit: 20,
        offset: 0,
      });

      expect(
        result.items.some(
          (item) => item.type === CareerTimelineEntryType.FOUNDED_GROUP,
        ),
      ).toBe(false);
    });
  });

  describe('manual entries mixed with SYSTEM entries', () => {
    it('sorts descending by occurredOn across both SYSTEM and MANUAL items, with a deterministic id tie-break', async () => {
      const user = buildUser({
        capoeiraStartedAt: new Date('2023-05-01'),
        showCapoeiraStartedAt: true,
      });
      const manualA = new CareerTimelineEntry();
      manualA.id = 'aaaa';
      manualA.type = CareerTimelineEntryType.OTHER;
      manualA.occurredOn = new Date('2023-05-01');
      manualA.title = 'Manual A';

      const manualC = new CareerTimelineEntry();
      manualC.id = 'cccc';
      manualC.type = CareerTimelineEntryType.OTHER;
      manualC.occurredOn = new Date('2024-01-01');
      manualC.title = 'Manual C';

      const service = buildService(
        buildMockEm({ entries: [manualA, manualC] }),
      );

      const full = await service.getTimeline(user, user.id, {
        limit: 20,
        offset: 0,
      });
      expect(full.items.map((item) => item.id)).toEqual([
        'cccc',
        'aaaa',
        'start-training:user-1',
      ]);
      expect(full.total).toBe(3);
    });
  });

  describe('date range filtering', () => {
    it('applies dateFrom/dateTo against occurredOn', async () => {
      const user = buildUser();
      const early = new CareerTimelineEntry();
      early.id = 'early';
      early.type = CareerTimelineEntryType.OTHER;
      early.occurredOn = new Date('2020-01-01');
      early.title = 'Early';

      const late = new CareerTimelineEntry();
      late.id = 'late';
      late.type = CareerTimelineEntryType.OTHER;
      late.occurredOn = new Date('2025-01-01');
      late.title = 'Late';

      const service = buildService(buildMockEm({ entries: [early, late] }));

      const result = await service.getTimeline(user, user.id, {
        dateFrom: '2021-01-01',
        limit: 20,
        offset: 0,
      });

      expect(result.items.map((item) => item.id)).toEqual(['late']);
    });
  });

  describe('type filtering', () => {
    it('only returns manual entries matching the requested types', async () => {
      const user = buildUser();
      const achievement = new CareerTimelineEntry();
      achievement.id = 'ach-1';
      achievement.type = CareerTimelineEntryType.ACHIEVEMENT;
      achievement.occurredOn = new Date('2020-01-01');
      achievement.title = 'Achievement';

      const other = new CareerTimelineEntry();
      other.id = 'other-1';
      other.type = CareerTimelineEntryType.OTHER;
      other.occurredOn = new Date('2021-01-01');
      other.title = 'Other';

      const service = buildService(
        buildMockEm({ entries: [achievement, other] }),
      );

      const result = await service.getTimeline(user, user.id, {
        types: [CareerTimelineEntryType.ACHIEVEMENT],
        limit: 20,
        offset: 0,
      });

      expect(result.items.map((item) => item.id)).toEqual(['ach-1']);
    });
  });

  // Audit §1: "kolejne awanse użytkownika" - a genuine, real rank change
  // always inserts a fresh FormalRankAssignment row (never overwrites the
  // previous one - see the entity's own comment), so every past rank grant
  // must keep showing up as its own RECEIVED_RANK item, not just the
  // current one.
  describe('consecutive rank promotions (audit §1)', () => {
    it('builds one RECEIVED_RANK item per FormalRankAssignment ever held, not just the current one', async () => {
      const user = buildUser({ showFormalRank: true });
      const graduado = new FormalRankAssignment();
      graduado.id = 'assignment-graduado';
      graduado.rank = buildRank({ id: 'rank-graduado', name: 'Graduado' });
      graduado.sourceGroup = buildGroup();
      graduado.startedOn = new Date('2017-01-01');
      graduado.endedOn = new Date('2022-01-01');
      graduado.event = null;

      const instrutor = new FormalRankAssignment();
      instrutor.id = 'assignment-instrutor';
      instrutor.rank = buildRank({ id: 'rank-instrutor', name: 'Instrutor' });
      instrutor.sourceGroup = buildGroup();
      instrutor.startedOn = new Date('2022-01-01');
      instrutor.endedOn = null;
      instrutor.event = null;

      const service = buildService(
        buildMockEm({ assignments: [graduado, instrutor] }),
      );

      const result = await service.getTimeline(user, user.id, {
        limit: 20,
        offset: 0,
      });

      const ranks = result.items.filter(
        (item) => item.type === CareerTimelineEntryType.RECEIVED_RANK,
      );
      expect(ranks.map((item) => item.id).sort()).toEqual(
        [
          'received-rank:assignment-graduado',
          'received-rank:assignment-instrutor',
        ].sort(),
      );
      expect(
        ranks.find((item) => item.id === 'received-rank:assignment-graduado')
          ?.occurredOn,
      ).toBe('2017-01-01');
      expect(
        ranks.find((item) => item.id === 'received-rank:assignment-instrutor')
          ?.occurredOn,
      ).toBe('2022-01-01');
    });
  });

  // Audit §2: a MANUAL entry and a later-recorded SYSTEM fact can describe
  // the same real-world event without any linkage between them - flagged
  // as a hint only, never merged/hidden/deleted automatically.
  describe('possibleDuplicateOfId (audit §2)', () => {
    function buildManualReceivedRank(
      overrides: Partial<CareerTimelineEntry> = {},
    ): CareerTimelineEntry {
      const entry = new CareerTimelineEntry();
      entry.id = 'manual-1';
      entry.type = CareerTimelineEntryType.RECEIVED_RANK;
      entry.occurredOn = new Date('2023-06-01');
      entry.occurredOnPrecision = CareerTimelinePrecision.DAY;
      entry.title = 'Otrzymanie stopnia Instrutor';
      entry.rankName = 'Instrutor';
      return Object.assign(entry, overrides);
    }

    function buildSystemAssignment(
      startedOn: string,
      group = buildGroup(),
    ): FormalRankAssignment {
      const assignment = new FormalRankAssignment();
      assignment.id = 'assignment-1';
      assignment.rank = buildRank({ name: 'Instrutor' });
      assignment.sourceGroup = group;
      assignment.startedOn = new Date(startedOn);
      assignment.event = null;
      return assignment;
    }

    it('flags a MANUAL item as a possible duplicate of a same-type, same-date SYSTEM item', async () => {
      const user = buildUser({
        showFormalRank: true,
        showCareerTimeline: true,
      });
      const manual = buildManualReceivedRank();
      const assignment = buildSystemAssignment('2023-06-01');
      const service = buildService(
        buildMockEm({ entries: [manual], assignments: [assignment] }),
      );

      const result = await service.getTimeline(user, user.id, {
        limit: 20,
        offset: 0,
      });

      const manualItem = result.items.find((item) => item.id === 'manual-1')!;
      expect(manualItem.possibleDuplicateOfId).toBe(
        'received-rank:assignment-1',
      );
      // The SYSTEM item itself, and every non-matching item, never gets one.
      const systemItem = result.items.find(
        (item) => item.id === 'received-rank:assignment-1',
      )!;
      expect(systemItem.possibleDuplicateOfId).toBeNull();
    });

    it('does not flag a duplicate when the SYSTEM item is a different type', async () => {
      const user = buildUser({
        showFormalGroup: true,
        showCareerTimeline: true,
      });
      const manual = buildManualReceivedRank();
      const affiliation = new FormalGroupAffiliation();
      affiliation.id = 'affiliation-1';
      affiliation.group = buildGroup();
      affiliation.startedOn = new Date('2023-06-01');
      const service = buildService(
        buildMockEm({ entries: [manual], affiliations: [affiliation] }),
      );

      const result = await service.getTimeline(user, user.id, {
        limit: 20,
        offset: 0,
      });

      expect(
        result.items.find((item) => item.id === 'manual-1')!
          .possibleDuplicateOfId,
      ).toBeNull();
    });

    it('does not flag a duplicate when both sides name a different, known Group', async () => {
      const user = buildUser({
        showFormalRank: true,
        showCareerTimeline: true,
      });
      const manual = buildManualReceivedRank({
        group: buildGroup('group-manual', 'Grupo Manual'),
        groupNameSnapshot: 'Grupo Manual',
      });
      const assignment = buildSystemAssignment(
        '2023-06-01',
        buildGroup('group-system', 'Grupo Sistema'),
      );
      const service = buildService(
        buildMockEm({ entries: [manual], assignments: [assignment] }),
      );

      const result = await service.getTimeline(user, user.id, {
        limit: 20,
        offset: 0,
      });

      expect(
        result.items.find((item) => item.id === 'manual-1')!
          .possibleDuplicateOfId,
      ).toBeNull();
    });

    it('is precision-aware: a YEAR-only MANUAL entry matches a SYSTEM item anywhere in that year', async () => {
      const user = buildUser({
        showFormalRank: true,
        showCareerTimeline: true,
      });
      const manual = buildManualReceivedRank({
        occurredOn: new Date(Date.UTC(2023, 0, 1)),
        occurredOnPrecision: CareerTimelinePrecision.YEAR,
      });
      const assignment = buildSystemAssignment('2023-09-20');
      const service = buildService(
        buildMockEm({ entries: [manual], assignments: [assignment] }),
      );

      const result = await service.getTimeline(user, user.id, {
        limit: 20,
        offset: 0,
      });

      expect(
        result.items.find((item) => item.id === 'manual-1')!
          .possibleDuplicateOfId,
      ).toBe('received-rank:assignment-1');
    });

    it('does not flag a duplicate when the dates fall in different years', async () => {
      const user = buildUser({
        showFormalRank: true,
        showCareerTimeline: true,
      });
      const manual = buildManualReceivedRank({
        occurredOn: new Date('2023-06-01'),
      });
      const assignment = buildSystemAssignment('2024-06-01');
      const service = buildService(
        buildMockEm({ entries: [manual], assignments: [assignment] }),
      );

      const result = await service.getTimeline(user, user.id, {
        limit: 20,
        offset: 0,
      });

      expect(
        result.items.find((item) => item.id === 'manual-1')!
          .possibleDuplicateOfId,
      ).toBeNull();
    });
  });

  // Audit §3: linked-Event snapshot + visibility.
  describe('linked Event snapshot and visibility (audit §3)', () => {
    it("prefers the entry's own event snapshot over the Event's current (possibly since-edited) name/date/location", async () => {
      const user = buildUser({ showCareerTimeline: true });
      const event = buildEvent({
        name: 'Festival Capoeira 2022 (renamed)',
        locationName: 'Warszawa (moved)',
        startsAt: new Date('2022-07-01T10:00:00.000Z'),
      });
      const entry = new CareerTimelineEntry();
      entry.id = 'manual-1';
      entry.type = CareerTimelineEntryType.IMPORTANT_EVENT;
      entry.occurredOn = new Date('2022-06-15');
      entry.title = 'Festival Capoeira 2022';
      entry.event = event;
      entry.eventNameSnapshot = 'Festival Capoeira 2022';
      entry.eventStartsAtSnapshot = new Date('2022-06-15T10:00:00.000Z');
      entry.eventLocationNameSnapshot = 'Poznań';

      const service = buildService(buildMockEm({ entries: [entry] }));

      const result = await service.getTimeline(user, user.id, {
        limit: 20,
        offset: 0,
      });

      const item = result.items.find((i) => i.id === 'manual-1')!;
      expect(item.event).toMatchObject({
        title: 'Festival Capoeira 2022',
        locationName: 'Poznań',
        startsAt: '2022-06-15T10:00:00.000Z',
      });
    });

    it("hides a non-owner viewer from a linked Event's details when they cannot access that Event, without hiding the rank fact itself", async () => {
      const viewer = buildUser({ id: 'viewer-1' });
      const target = buildUser({
        id: 'target-1',
        showCareerTimeline: true,
        showFormalRank: true,
      });
      const event = buildEvent();
      const assignment = new FormalRankAssignment();
      assignment.id = 'assignment-1';
      assignment.rank = buildRank();
      assignment.sourceGroup = buildGroup();
      assignment.startedOn = new Date('2022-06-15');
      assignment.event = event;

      const em = buildMockEm({ user: target, assignments: [assignment] });
      const { service: eventAccessService, isVisibleToViewer } =
        buildMockEventAccessService(() => Promise.resolve(false));
      const service = buildService(
        em,
        buildMockCorrectionService().service,
        eventAccessService,
      );

      const result = await service.getTimeline(viewer, target.id, {
        limit: 20,
        offset: 0,
      });

      expect(isVisibleToViewer).toHaveBeenCalledWith(
        em,
        event,
        viewer.id,
        viewer.email,
      );
      const item = result.items.find(
        (i) => i.id === 'received-rank:assignment-1',
      )!;
      expect(item).toBeDefined();
      expect(item.title).toBe(`Otrzymanie stopnia ${assignment.rank.name}`);
      expect(item.event).toBeNull();
    });

    it("always shows the linked Event to the owner, regardless of the Event's own visibility", async () => {
      const user = buildUser({ showFormalRank: true });
      const event = buildEvent();
      const assignment = new FormalRankAssignment();
      assignment.id = 'assignment-1';
      assignment.rank = buildRank();
      assignment.sourceGroup = buildGroup();
      assignment.startedOn = new Date('2022-06-15');
      assignment.event = event;

      const em = buildMockEm({ assignments: [assignment] });
      const { service: eventAccessService, isVisibleToViewer } =
        buildMockEventAccessService(() => Promise.resolve(false));
      const service = buildService(
        em,
        buildMockCorrectionService().service,
        eventAccessService,
      );

      const result = await service.getTimeline(user, user.id, {
        limit: 20,
        offset: 0,
      });

      expect(isVisibleToViewer).not.toHaveBeenCalled();
      expect(
        result.items.find((i) => i.id === 'received-rank:assignment-1')!.event,
      ).not.toBeNull();
    });
  });
});
