import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EntityManager, LockMode } from '@mikro-orm/postgresql';
import { User } from '../users/entities/user.entity';
import { CreateSongEditProposalInput } from './dto/create-song-edit-proposal.schema';
import { ModerationReasonInput } from './dto/moderation-reason.schema';
import { SongEditProposalResponseDto } from './dto/song-edit-proposal-response.dto';
import { SongEditProposal } from './entities/song-edit-proposal.entity';
import { Song } from './entities/song.entity';
import { SongEditProposalStatus } from './enums/song-edit-proposal-status.enum';
import { SongStatus } from './enums/song-status.enum';
import { toSongEditProposalResponseDto } from './mappers/song-edit-proposal.mapper';
import { SongContentService } from './song-content.service';

const PROPOSAL_POPULATE = ['proposedBy', 'reviewedBy'] as const;

/**
 * Edit workflow for a *protected* Song (PUBLISHED/HIDDEN) - see the
 * moderation model and SongsService.assertDirectlyEditable's own comment on
 * why such a Song can no longer be reached through SongsService.update()
 * directly. A SongEditProposal holds a full snapshot (SongEditProposal.
 * payload), never a diff; approving one applies that snapshot to the Song
 * via SongContentService.replaceContent() - the exact same rebuild logic a
 * direct DRAFT/REJECTED update uses - so nothing here duplicates that logic.
 */
@Injectable()
export class SongEditProposalsService {
  constructor(
    private readonly em: EntityManager,
    private readonly songContentService: SongContentService,
  ) {}

  // No permission or ownership check here - once a Song is protected,
  // createdBy no longer grants any exclusive edit right over it (see the
  // moderation model's central rule), and proposing a change requires
  // nothing beyond being authenticated: it never mutates the Song by
  // itself, only approve() does (CONTENT_APPROVE-gated at the controller).
  // Any signed-in user may propose a change to anyone's published content.
  async create(
    songId: string,
    actor: User,
    input: CreateSongEditProposalInput,
  ): Promise<SongEditProposalResponseDto> {
    const proposal = await this.em.transactional(async (em) => {
      const song = await this.loadSongOrFail(em, songId);
      this.assertProtected(song);

      // Validated the same way a direct update/create would be (active
      // category, active tags) but never applied - see
      // SongContentService.assertApplicable's own comment on why a
      // malformed snapshot must never be persisted, since approve() later
      // has no other chance to reject it structurally.
      await this.songContentService.assertApplicable(em, input);

      const proposal = new SongEditProposal();
      proposal.song = song;
      proposal.proposedBy = actor;
      proposal.status = SongEditProposalStatus.PENDING;
      proposal.payload = input;
      await em.persist(proposal).flush();

      return proposal;
    });

    return this.toResponseDto(proposal.id);
  }

  async list(songId: string): Promise<SongEditProposalResponseDto[]> {
    await this.loadSongOrFail(this.em, songId);

    const proposals = await this.em.find(
      SongEditProposal,
      { song: songId },
      { populate: [...PROPOSAL_POPULATE], orderBy: { createdAt: 'desc' } },
    );
    return proposals.map(toSongEditProposalResponseDto);
  }

  async getById(
    songId: string,
    proposalId: string,
  ): Promise<SongEditProposalResponseDto> {
    const proposal = await this.loadProposalOrFail(this.em, songId, proposalId);
    return toSongEditProposalResponseDto(proposal);
  }

  // Atomically: apply the stored snapshot to the Song (via the exact same
  // SongContentService.replaceContent() a direct update uses - see the
  // class comment), mark the proposal APPROVED, and stamp reviewedBy/
  // reviewedAt. Never touches Song.status - a PUBLISHED Song stays
  // PUBLISHED, a HIDDEN one stays HIDDEN; approving a content change is not
  // a lifecycle transition.
  async approve(
    songId: string,
    proposalId: string,
    actor: User,
  ): Promise<SongEditProposalResponseDto> {
    await this.em.transactional(async (em) => {
      const proposal = await this.loadProposalOrFail(
        em,
        songId,
        proposalId,
        /* lock */ true,
      );
      this.assertPending(proposal);
      this.assertNotSelfReview(proposal, actor);

      const song = await this.loadSongOrFail(em, songId);
      // A deleted proposer (proposedBy set null - see the entity's own
      // comment) has no one left to attribute new media rows to; the
      // reviewer stands in rather than leaving media ownerless.
      const mediaOwner = proposal.proposedBy ?? actor;
      await this.songContentService.replaceContent(
        em,
        song,
        proposal.payload,
        mediaOwner,
      );

      proposal.status = SongEditProposalStatus.APPROVED;
      proposal.reviewedBy = actor;
      proposal.reviewedAt = new Date();
      await em.flush();
    });

    return this.toResponseDto(proposalId);
  }

  // Never touches the Song - it stays exactly as it was, published version
  // fully intact.
  async reject(
    songId: string,
    proposalId: string,
    actor: User,
    input: ModerationReasonInput,
  ): Promise<SongEditProposalResponseDto> {
    await this.em.transactional(async (em) => {
      const proposal = await this.loadProposalOrFail(
        em,
        songId,
        proposalId,
        /* lock */ true,
      );
      this.assertPending(proposal);
      this.assertNotSelfReview(proposal, actor);

      proposal.status = SongEditProposalStatus.REJECTED;
      proposal.rejectionReason = input.reason;
      proposal.reviewedBy = actor;
      proposal.reviewedAt = new Date();
      await em.flush();
    });

    return this.toResponseDto(proposalId);
  }

  private async toResponseDto(
    proposalId: string,
  ): Promise<SongEditProposalResponseDto> {
    const proposal = await this.em.findOneOrFail(
      SongEditProposal,
      { id: proposalId },
      { populate: [...PROPOSAL_POPULATE] },
    );
    return toSongEditProposalResponseDto(proposal);
  }

  // Only PUBLISHED/HIDDEN content is protected - proposing a change to a
  // DRAFT/PENDING_REVIEW/REJECTED Song makes no sense (its own creator can
  // just edit it directly, or it isn't live yet at all).
  private assertProtected(song: Song): void {
    if (
      song.status !== SongStatus.PUBLISHED &&
      song.status !== SongStatus.HIDDEN
    ) {
      throw new ConflictException({
        code: 'EDIT_PROPOSAL_TARGET_NOT_PROTECTED',
        message:
          'Edit proposals only apply to published or hidden songs - edit this song directly instead',
      });
    }
  }

  private assertPending(proposal: SongEditProposal): void {
    if (proposal.status !== SongEditProposalStatus.PENDING) {
      throw new ConflictException({
        code: 'EDIT_PROPOSAL_NOT_PENDING',
        message: `This proposal was already ${proposal.status.toLowerCase()} and cannot be reviewed again`,
      });
    }
  }

  // The proposer can never review (approve or reject) their own proposal,
  // even when they separately hold CONTENT_APPROVE - mirrors
  // SongsService.assertNotSelfApproval for the original submission.
  private assertNotSelfReview(proposal: SongEditProposal, actor: User): void {
    if (proposal.proposedBy?.id === actor.id) {
      throw new ForbiddenException({
        code: 'SELF_APPROVAL_FORBIDDEN',
        message: 'You cannot approve or reject your own edit proposal',
      });
    }
  }

  private async loadSongOrFail(
    em: EntityManager,
    songId: string,
  ): Promise<Song> {
    const song = await em.findOne(Song, { id: songId });
    if (!song) {
      throw new NotFoundException({
        code: 'SONG_NOT_FOUND',
        message: 'Song not found',
      });
    }
    return song;
  }

  // `lock` guards approve()/reject() against a concurrent double-review of
  // the same proposal - a second reviewer racing the first blocks on the
  // row lock and, once it acquires it, observes the already-terminal
  // status via assertPending() and is rejected, mirroring
  // HierarchyManagementService.acceptInvitation's own pattern.
  private async loadProposalOrFail(
    em: EntityManager,
    songId: string,
    proposalId: string,
    lock = false,
  ): Promise<SongEditProposal> {
    const proposal = await em.findOne(
      SongEditProposal,
      { id: proposalId, song: songId },
      lock ? { lockMode: LockMode.PESSIMISTIC_WRITE } : {},
    );
    if (!proposal) {
      throw new NotFoundException({
        code: 'EDIT_PROPOSAL_NOT_FOUND',
        message: 'Edit proposal not found',
      });
    }
    return proposal;
  }
}
