import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import type { EntityManager } from '@mikro-orm/postgresql';
import { User } from '../users/entities/user.entity';
import { CreateSongEditProposalInput } from './dto/create-song-edit-proposal.schema';
import { SongCategory } from './entities/song-category.entity';
import { SongEditProposal } from './entities/song-edit-proposal.entity';
import { Song } from './entities/song.entity';
import { SongEditProposalStatus } from './enums/song-edit-proposal-status.enum';
import { SongStatus } from './enums/song-status.enum';
import { SongPerformer } from './enums/song-performer.enum';
import { SongContentService } from './song-content.service';
import { SongEditProposalsService } from './song-edit-proposals.service';

function buildUser(overrides: Partial<User> = {}): User {
  const user = new User();
  user.email = 'user@example.com';
  user.displayName = 'Test User';
  return Object.assign(user, overrides);
}

function buildSong(overrides: Partial<Song> = {}): Song {
  const song = new Song();
  song.title = 'Paranauê';
  song.status = SongStatus.PUBLISHED;
  const category = new SongCategory();
  category.code = 'CORRIDO';
  category.name = 'Corrido';
  category.position = 1;
  category.isActive = true;
  song.category = category;
  return Object.assign(song, overrides);
}

function buildInput(
  overrides: Partial<CreateSongEditProposalInput> = {},
): CreateSongEditProposalInput {
  return {
    title: 'Paranauê (revised)',
    authorName: null,
    categoryId: 'category-id',
    alternativeTitles: [],
    tagIds: [],
    parts: [
      {
        performer: SongPerformer.LEAD,
        position: 1,
        lines: [
          {
            originalText: 'a',
            phoneticText: null,
            position: 1,
            translations: [],
          },
        ],
      },
    ],
    media: [],
    meaningHistory: null,
    meaningContext: null,
    meaningTrivia: null,
    ...overrides,
  };
}

function buildProposal(
  overrides: Partial<SongEditProposal> = {},
): SongEditProposal {
  const proposal = new SongEditProposal();
  proposal.song = buildSong();
  proposal.proposedBy = buildUser();
  proposal.status = SongEditProposalStatus.PENDING;
  proposal.payload = buildInput();
  return Object.assign(proposal, overrides);
}

interface FindOneRouting {
  song?: Song | null;
  proposal?: SongEditProposal | null;
}

function buildMockEm(routing: FindOneRouting = {}) {
  const flush = jest.fn().mockResolvedValue(undefined);
  const persist = jest
    .fn<{ flush: jest.Mock }, [object]>()
    .mockReturnValue({ flush });
  const find = jest.fn().mockResolvedValue([]);

  const findOne = jest.fn().mockImplementation((entity: unknown) => {
    if (entity === Song) {
      return Promise.resolve(
        routing.song === undefined ? buildSong() : routing.song,
      );
    }
    if (entity === SongEditProposal) {
      return Promise.resolve(
        routing.proposal === undefined ? buildProposal() : routing.proposal,
      );
    }
    return Promise.resolve(null);
  });

  const findOneOrFail = jest
    .fn()
    .mockImplementation(async (entity: unknown, where: unknown) => {
      const result: unknown = await findOne(entity, where);
      if (!result) {
        throw new Error('not found');
      }
      return result;
    });

  const em = {
    findOne,
    findOneOrFail,
    find,
    persist,
    flush,
    transactional: undefined as unknown as jest.Mock,
  };
  em.transactional = jest.fn((cb: (em: unknown) => unknown) => cb(em));

  return em as unknown as EntityManager & {
    transactional: jest.Mock;
    findOne: jest.Mock;
    findOneOrFail: jest.Mock;
    find: jest.Mock;
    persist: jest.Mock<{ flush: jest.Mock }, [object]>;
    flush: jest.Mock;
  };
}

function buildMockSongContentService(): SongContentService {
  return {
    assertApplicable: jest.fn().mockResolvedValue(undefined),
    replaceContent: jest.fn().mockResolvedValue(undefined),
  } as unknown as SongContentService;
}

describe('SongEditProposalsService', () => {
  describe('create', () => {
    it('creates a PENDING proposal for a PUBLISHED song, without touching the Song', async () => {
      const song = buildSong({ status: SongStatus.PUBLISHED });
      const em = buildMockEm({ song, proposal: undefined });
      let persisted: SongEditProposal | undefined;
      em.persist.mockImplementation((entity: unknown) => {
        persisted = entity as SongEditProposal;
        return { flush: em.flush };
      });
      const songContentService = buildMockSongContentService();
      const service = new SongEditProposalsService(em, songContentService);
      const proposer = buildUser();

      await service.create(
        song.id,
        proposer,
        buildInput({ title: 'New title' }),
      );

      expect(persisted).toBeInstanceOf(SongEditProposal);
      expect(persisted?.status).toBe(SongEditProposalStatus.PENDING);
      expect(persisted?.proposedBy).toBe(proposer);
      expect(persisted?.payload.title).toBe('New title');
      expect(song.title).not.toBe('New title');
      // eslint-disable-next-line @typescript-eslint/unbound-method -- assertion target only
      expect(songContentService.replaceContent).not.toHaveBeenCalled();
    });

    it.each([SongStatus.DRAFT, SongStatus.PENDING_REVIEW, SongStatus.REJECTED])(
      'rejects proposing an edit for a %s song with 409 EDIT_PROPOSAL_TARGET_NOT_PROTECTED',
      async (status) => {
        const song = buildSong({ status });
        const em = buildMockEm({ song });
        const service = new SongEditProposalsService(
          em,
          buildMockSongContentService(),
        );

        const error: unknown = await service
          .create(song.id, buildUser(), buildInput())
          .catch((caught: unknown) => caught);

        expect(error).toBeInstanceOf(ConflictException);
        expect((error as ConflictException).getResponse()).toMatchObject({
          code: 'EDIT_PROPOSAL_TARGET_NOT_PROTECTED',
        });
      },
    );

    it('throws NotFoundException for a missing song', async () => {
      const em = buildMockEm({ song: null });
      const service = new SongEditProposalsService(
        em,
        buildMockSongContentService(),
      );

      await expect(
        service.create('missing-id', buildUser(), buildInput()),
      ).rejects.toThrow(NotFoundException);
    });

    it('validates the payload via SongContentService.assertApplicable before persisting', async () => {
      const song = buildSong();
      const em = buildMockEm({ song });
      const songContentService = buildMockSongContentService();
      (songContentService.assertApplicable as jest.Mock).mockRejectedValue(
        new Error('invalid category'),
      );
      const service = new SongEditProposalsService(em, songContentService);

      await expect(
        service.create(song.id, buildUser(), buildInput()),
      ).rejects.toThrow('invalid category');
      expect(em.persist).not.toHaveBeenCalled();
    });
  });

  describe('list', () => {
    it('throws NotFoundException for a missing song', async () => {
      const em = buildMockEm({ song: null });
      const service = new SongEditProposalsService(
        em,
        buildMockSongContentService(),
      );

      await expect(service.list('missing-id')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('approve', () => {
    it('atomically applies the snapshot to the Song, marks the proposal APPROVED, and stamps the reviewer', async () => {
      const song = buildSong({ status: SongStatus.PUBLISHED });
      const proposer = buildUser({ email: 'proposer@example.com' });
      const reviewer = buildUser({ email: 'reviewer@example.com' });
      const proposal = buildProposal({
        song,
        proposedBy: proposer,
        status: SongEditProposalStatus.PENDING,
      });
      const em = buildMockEm({ song, proposal });
      const songContentService = buildMockSongContentService();
      const service = new SongEditProposalsService(em, songContentService);

      await service.approve(song.id, proposal.id, reviewer);

      // eslint-disable-next-line @typescript-eslint/unbound-method -- assertion target only
      expect(songContentService.replaceContent).toHaveBeenCalledWith(
        em,
        song,
        proposal.payload,
        proposer,
      );
      expect(proposal.status).toBe(SongEditProposalStatus.APPROVED);
      expect(proposal.reviewedBy).toBe(reviewer);
      expect(proposal.reviewedAt).toBeInstanceOf(Date);
      // Never a lifecycle transition - status stays whatever it already was.
      expect(song.status).toBe(SongStatus.PUBLISHED);
    });

    it('falls back to the reviewer as mediaOwner when the original proposer was deleted', async () => {
      const song = buildSong();
      const reviewer = buildUser();
      const proposal = buildProposal({ song, proposedBy: null });
      const em = buildMockEm({ song, proposal });
      const songContentService = buildMockSongContentService();
      const service = new SongEditProposalsService(em, songContentService);

      await service.approve(song.id, proposal.id, reviewer);

      // eslint-disable-next-line @typescript-eslint/unbound-method -- assertion target only
      expect(songContentService.replaceContent).toHaveBeenCalledWith(
        em,
        song,
        proposal.payload,
        reviewer,
      );
    });

    it('rejects approving a non-PENDING proposal with 409 EDIT_PROPOSAL_NOT_PENDING', async () => {
      const proposal = buildProposal({
        status: SongEditProposalStatus.APPROVED,
      });
      const em = buildMockEm({ proposal });
      const songContentService = buildMockSongContentService();
      const service = new SongEditProposalsService(em, songContentService);

      const error: unknown = await service
        .approve('song-id', proposal.id, buildUser())
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(ConflictException);
      expect((error as ConflictException).getResponse()).toMatchObject({
        code: 'EDIT_PROPOSAL_NOT_PENDING',
      });
      // eslint-disable-next-line @typescript-eslint/unbound-method -- assertion target only
      expect(songContentService.replaceContent).not.toHaveBeenCalled();
    });

    it('rejects self-approval with 403 SELF_APPROVAL_FORBIDDEN, even for the proposal author', async () => {
      const author = buildUser();
      const proposal = buildProposal({ proposedBy: author });
      const em = buildMockEm({ proposal });
      const songContentService = buildMockSongContentService();
      const service = new SongEditProposalsService(em, songContentService);

      const error: unknown = await service
        .approve('song-id', proposal.id, author)
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(ForbiddenException);
      expect((error as ForbiddenException).getResponse()).toMatchObject({
        code: 'SELF_APPROVAL_FORBIDDEN',
      });
      // eslint-disable-next-line @typescript-eslint/unbound-method -- assertion target only
      expect(songContentService.replaceContent).not.toHaveBeenCalled();
      expect(proposal.status).toBe(SongEditProposalStatus.PENDING);
    });
  });

  describe('reject', () => {
    it('marks the proposal REJECTED with the given reason, and never touches the Song', async () => {
      const song = buildSong({ title: 'Untouched title' });
      const reviewer = buildUser();
      const proposal = buildProposal({
        song,
        status: SongEditProposalStatus.PENDING,
      });
      const em = buildMockEm({ song, proposal });
      const service = new SongEditProposalsService(
        em,
        buildMockSongContentService(),
      );

      await service.reject('song-id', proposal.id, reviewer, {
        reason: 'Needs another source',
      });

      expect(proposal.status).toBe(SongEditProposalStatus.REJECTED);
      expect(proposal.rejectionReason).toBe('Needs another source');
      expect(proposal.reviewedBy).toBe(reviewer);
      expect(song.title).toBe('Untouched title');
    });

    it('rejects rejecting a non-PENDING proposal with 409 EDIT_PROPOSAL_NOT_PENDING', async () => {
      const proposal = buildProposal({
        status: SongEditProposalStatus.REJECTED,
      });
      const em = buildMockEm({ proposal });
      const service = new SongEditProposalsService(
        em,
        buildMockSongContentService(),
      );

      await expect(
        service.reject('song-id', proposal.id, buildUser(), { reason: null }),
      ).rejects.toThrow(ConflictException);
    });

    it('rejects self-review with 403 SELF_APPROVAL_FORBIDDEN', async () => {
      const author = buildUser();
      const proposal = buildProposal({ proposedBy: author });
      const em = buildMockEm({ proposal });
      const service = new SongEditProposalsService(
        em,
        buildMockSongContentService(),
      );

      await expect(
        service.reject('song-id', proposal.id, author, { reason: null }),
      ).rejects.toThrow(ForbiddenException);
      expect(proposal.status).toBe(SongEditProposalStatus.PENDING);
    });
  });

  describe('getById', () => {
    it('throws NotFoundException when the proposal does not exist for that song', async () => {
      const em = buildMockEm({ proposal: null });
      const service = new SongEditProposalsService(
        em,
        buildMockSongContentService(),
      );

      await expect(
        service.getById('song-id', 'missing-proposal-id'),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
