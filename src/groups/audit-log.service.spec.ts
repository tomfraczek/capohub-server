import type { EntityManager } from '@mikro-orm/postgresql';
import { User } from '../users/entities/user.entity';
import { AuditLogService } from './audit-log.service';
import { AuditLogQuery } from './dto/audit-log-query.schema';
import { AuditLogEntry } from './entities/audit-log-entry.entity';
import { Group } from './entities/group.entity';
import { Section } from './entities/section.entity';
import { AuditAction } from './enums/audit-action.enum';
import { AuditTargetType } from './enums/audit-target-type.enum';

function buildGroup(overrides: Partial<Group> = {}): Group {
  const group = new Group();
  group.id = 'group-1';
  group.name = 'Cordão de Ouro';
  return Object.assign(group, overrides);
}

function buildSection(overrides: Partial<Section> = {}): Section {
  const section = new Section();
  section.id = 'section-1';
  section.name = 'Cordão de Ouro Poznan';
  return Object.assign(section, overrides);
}

function buildUser(overrides: Partial<User> = {}): User {
  const user = new User();
  user.id = 'user-1';
  user.displayName = 'Ana Silva';
  user.firstName = 'Ana';
  user.lastName = 'Silva';
  return Object.assign(user, overrides);
}

function buildEntry(overrides: Partial<AuditLogEntry> = {}): AuditLogEntry {
  const entry = new AuditLogEntry();
  entry.id = 'entry-1';
  entry.group = buildGroup();
  entry.section = null;
  entry.action = AuditAction.REMOVE_MEMBER;
  entry.actor = buildUser();
  entry.targetType = AuditTargetType.USER;
  entry.targetId = 'target-user-1';
  entry.description = null;
  entry.metadata = null;
  entry.createdAt = new Date('2026-01-01T00:00:00.000Z');
  return Object.assign(entry, overrides);
}

function buildQuery(overrides: Partial<AuditLogQuery> = {}): AuditLogQuery {
  return { page: 1, limit: 20, sort: '-createdAt', ...overrides };
}

function buildMockEm(findAndCountResult: [AuditLogEntry[], number] = [[], 0]) {
  const persist = jest.fn<void, [AuditLogEntry]>();
  const findAndCount = jest.fn().mockResolvedValue(findAndCountResult);

  const em = {
    persist,
    findAndCount,
  } as unknown as EntityManager;

  return { em, persist, findAndCount };
}

describe('AuditLogService', () => {
  describe('record', () => {
    it('persists a new AuditLogEntry with every given field, under `group` for a Group community', () => {
      const { em, persist } = buildMockEm();
      const service = new AuditLogService(em);
      const community = buildGroup();
      const actor = buildUser();

      service.record(em, {
        community,
        action: AuditAction.BAN,
        actor,
        targetType: AuditTargetType.USER,
        targetId: 'target-1',
        description: 'Repeated rule violations',
        metadata: { reason: 'spam' },
      });

      expect(persist).toHaveBeenCalledTimes(1);
      const persisted = persist.mock.calls[0][0];
      expect(persisted.group).toBe(community);
      expect(persisted.section).toBeNull();
      expect(persisted.action).toBe(AuditAction.BAN);
      expect(persisted.actor).toBe(actor);
      expect(persisted.targetType).toBe(AuditTargetType.USER);
      expect(persisted.targetId).toBe('target-1');
      expect(persisted.description).toBe('Repeated rule violations');
      expect(persisted.metadata).toEqual({ reason: 'spam' });
    });

    it('persists under `section`, not `group`, for a Section community - no inheritance to any resolved root', () => {
      const { em, persist } = buildMockEm();
      const service = new AuditLogService(em);
      const community = buildSection();

      service.record(em, {
        community,
        action: AuditAction.LEAVE_COMMUNITY,
        actor: buildUser(),
      });

      const persisted = persist.mock.calls[0][0];
      expect(persisted.section).toBe(community);
      expect(persisted.group).toBeNull();
    });

    it('defaults every optional field to null when omitted', () => {
      const { em, persist } = buildMockEm();
      const service = new AuditLogService(em);

      service.record(em, {
        community: buildGroup(),
        action: AuditAction.CREATE_COMMUNITY,
        actor: buildUser(),
      });

      const persisted = persist.mock.calls[0][0];
      expect(persisted.targetType).toBeNull();
      expect(persisted.targetId).toBeNull();
      expect(persisted.description).toBeNull();
      expect(persisted.metadata).toBeNull();
    });

    it('accepts a null actor for a hypothetical system-initiated entry', () => {
      const { em, persist } = buildMockEm();
      const service = new AuditLogService(em);

      service.record(em, {
        community: buildGroup(),
        action: AuditAction.UNSUSPEND,
        actor: null,
      });

      const persisted = persist.mock.calls[0][0];
      expect(persisted.actor).toBeNull();
    });
  });

  describe('list', () => {
    it('maps each entry to its response DTO shape, including a resolved actor ref', async () => {
      const entry = buildEntry();
      const { em } = buildMockEm([[entry], 1]);
      const service = new AuditLogService(em);

      const result = await service.list('group-1', buildQuery());

      expect(result.data).toEqual([
        {
          id: 'entry-1',
          communityId: 'group-1',
          action: AuditAction.REMOVE_MEMBER,
          actor: { id: 'user-1', displayName: 'Ana Silva' },
          target: { type: AuditTargetType.USER, id: 'target-user-1' },
          description: null,
          metadata: null,
          createdAt: '2026-01-01T00:00:00.000Z',
        },
      ]);
      expect(result.meta.totalItems).toBe(1);
    });

    it('maps a null actor/target to null in the response, not a fabricated placeholder', async () => {
      const entry = buildEntry({
        actor: null,
        targetType: null,
        targetId: null,
      });
      const { em } = buildMockEm([[entry], 1]);
      const service = new AuditLogService(em);

      const result = await service.list('group-1', buildQuery());

      expect(result.data[0].actor).toBeNull();
      expect(result.data[0].target).toBeNull();
    });

    it('resolves communityId from `section` when the entry is Section-scoped', async () => {
      const entry = buildEntry({ group: null, section: buildSection() });
      const { em } = buildMockEm([[entry], 1]);
      const service = new AuditLogService(em);

      const result = await service.list('section-1', buildQuery());

      expect(result.data[0].communityId).toBe('section-1');
    });

    it('scopes the query to the given community id (Group or Section, via $or)', async () => {
      const { em, findAndCount } = buildMockEm();
      const service = new AuditLogService(em);

      await service.list('group-1', buildQuery());

      expect(findAndCount).toHaveBeenCalledWith(
        AuditLogEntry,
        expect.objectContaining({
          $or: [{ group: 'group-1' }, { section: 'group-1' }],
        }),
        expect.anything(),
      );
    });

    it('adds an action filter only when given', async () => {
      const { em, findAndCount } = buildMockEm();
      const service = new AuditLogService(em);

      await service.list('group-1', buildQuery({ action: AuditAction.BAN }));

      expect(findAndCount).toHaveBeenCalledWith(
        AuditLogEntry,
        expect.objectContaining({
          $or: [{ group: 'group-1' }, { section: 'group-1' }],
          action: AuditAction.BAN,
        }),
        expect.anything(),
      );
    });

    it('adds an actorId filter only when given', async () => {
      const { em, findAndCount } = buildMockEm();
      const service = new AuditLogService(em);

      await service.list('group-1', buildQuery({ actorId: 'user-2' }));

      expect(findAndCount).toHaveBeenCalledWith(
        AuditLogEntry,
        expect.objectContaining({
          $or: [{ group: 'group-1' }, { section: 'group-1' }],
          actor: 'user-2',
        }),
        expect.anything(),
      );
    });

    it('sorts ascending when the sort value has no "-" prefix', async () => {
      const { em, findAndCount } = buildMockEm();
      const service = new AuditLogService(em);

      await service.list('group-1', buildQuery({ sort: 'createdAt' }));

      expect(findAndCount).toHaveBeenCalledWith(
        AuditLogEntry,
        expect.anything(),
        expect.objectContaining({ orderBy: { createdAt: 'asc' } }),
      );
    });

    it('sorts descending by default (-createdAt)', async () => {
      const { em, findAndCount } = buildMockEm();
      const service = new AuditLogService(em);

      await service.list('group-1', buildQuery());

      expect(findAndCount).toHaveBeenCalledWith(
        AuditLogEntry,
        expect.anything(),
        expect.objectContaining({ orderBy: { createdAt: 'desc' } }),
      );
    });

    it('applies page/limit as offset/limit', async () => {
      const { em, findAndCount } = buildMockEm();
      const service = new AuditLogService(em);

      await service.list('group-1', buildQuery({ page: 3, limit: 10 }));

      expect(findAndCount).toHaveBeenCalledWith(
        AuditLogEntry,
        expect.anything(),
        expect.objectContaining({ limit: 10, offset: 20 }),
      );
    });
  });
});
