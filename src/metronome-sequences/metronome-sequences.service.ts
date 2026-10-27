import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EntityManager } from '@mikro-orm/postgresql';
import { PaginatedResponse } from '../common/pagination/pagination.types';
import { PaginationQuery } from '../common/pagination/pagination-query.schema';
import { createPaginationMeta } from '../common/pagination/pagination.utils';
import { Section } from '../groups/entities/section.entity';
import { SectionMembership } from '../groups/entities/section-membership.entity';
import { GroupStatus } from '../groups/enums/group-status.enum';
import { SectionMembershipStatus } from '../groups/enums/section-membership-status.enum';
import { GroupPermission } from '../groups/permissions/group-permission.enum';
import { GroupPermissionService } from '../groups/permissions/group-permission.service';
import { RoleAssignmentsService } from '../groups/role-assignments.service';
import { User } from '../users/entities/user.entity';
import {
  MetronomeSequenceResponseDto,
  MetronomeSequenceSectionDto,
  SectionMetronomeSequenceResponseDto,
} from './dto/metronome-sequence-response.dto';
import { SaveMetronomeSequenceInput } from './dto/save-metronome-sequence.schema';
import { MetronomeSequence } from './entities/metronome-sequence.entity';
import { SectionMetronomeSequence } from './entities/section-metronome-sequence.entity';
import {
  toMetronomeSequenceResponseDto,
  toSectionDto,
  toSectionMetronomeSequenceResponseDto,
} from './mappers/metronome-sequence.mapper';
import { METRONOME_MAX_SEQUENCES_PER_USER } from './metronome-sequence.constants';

export type SaveResult = {
  sequence: MetronomeSequenceResponseDto;
  created: boolean;
};

const byName = (a: { name: string }, b: { name: string }) =>
  a.name.localeCompare(b.name);

@Injectable()
export class MetronomeSequencesService {
  constructor(
    private readonly em: EntityManager,
    private readonly roleAssignmentsService: RoleAssignmentsService,
    private readonly groupPermissionService: GroupPermissionService,
  ) {}

  // --- Own sequences ------------------------------------------------------

  async listMine(userId: string): Promise<MetronomeSequenceResponseDto[]> {
    const sequences = await this.em.find(
      MetronomeSequence,
      { owner: userId },
      { populate: ['originalAuthor'], orderBy: { updatedAt: 'desc' } },
    );
    const shared = await this.loadSharedSections(
      this.em,
      sequences.map((sequence) => sequence.id),
    );

    return sequences.map((sequence) =>
      toMetronomeSequenceResponseDto(sequence, shared.get(sequence.id) ?? []),
    );
  }

  // Create-or-replace under an id the app chose. Saving the same id again
  // (a retried offline save) updates instead of duplicating; an id that
  // belongs to someone else is never touched.
  async save(
    user: User,
    id: string,
    input: SaveMetronomeSequenceInput,
  ): Promise<SaveResult> {
    const existing = await this.em.findOne(MetronomeSequence, { id });
    let created = false;
    let sequence: MetronomeSequence;

    if (existing) {
      if (existing.owner.id !== user.id) {
        throw new ConflictException('Sequence id is already in use');
      }
      sequence = existing;
    } else {
      await this.assertBelowLimit(this.em, user.id);
      sequence = new MetronomeSequence();
      sequence.id = id;
      sequence.owner = user;
      created = true;
    }

    sequence.title = input.title;
    sequence.instrument = input.instrument;
    sequence.bpm = input.bpm;
    sequence.division = input.division;
    sequence.steps = input.steps.map(({ sound, muted }) => ({ sound, muted }));
    await this.em.persist(sequence).flush();

    return { sequence: await this.getOwned(user.id, id), created };
  }

  // Its Section shares go with it (ON DELETE CASCADE); copies members saved
  // are their own sequences and stay.
  async delete(userId: string, id: string): Promise<void> {
    const sequence = await this.em.findOne(MetronomeSequence, {
      id,
      owner: userId,
    });
    if (!sequence) {
      throw this.notFound();
    }
    await this.em.remove(sequence).flush();
  }

  // --- Sharing in Sections ---------------------------------------------

  // The Sections the user may share sequences in right now: an active
  // membership whose Roles grant METRONOME_SEQUENCE_SHARE (OWNER/ADMIN), in
  // an ACTIVE Section - the same rules GroupPermissionsGuard applies.
  async listShareableSections(
    userId: string,
  ): Promise<MetronomeSequenceSectionDto[]> {
    const memberships = await this.em.find(
      SectionMembership,
      { user: userId, status: SectionMembershipStatus.ACTIVE },
      { populate: ['section'] },
    );
    const sections: MetronomeSequenceSectionDto[] = [];

    for (const membership of memberships) {
      if (await this.canShareIn(userId, membership.section.id)) {
        sections.push(toSectionDto(membership.section));
      }
    }

    return sections.sort(byName);
  }

  // Sets the complete list of Sections the user's own sequence is shared
  // in. Adding a Section requires managing it; withdrawing a share is
  // always allowed to the sequence's owner.
  async setSharedSections(
    user: User,
    sequenceId: string,
    sectionIds: string[],
  ): Promise<MetronomeSequenceSectionDto[]> {
    await this.em.transactional(async (em) => {
      // Concurrent updates of one sequence's shares (a double tap) run one
      // after another, so the unique (section, sequence) pair is never hit.
      await em
        .getConnection()
        .execute('select pg_advisory_xact_lock(hashtext(?))', [
          `metronome-share:${sequenceId}`,
        ]);

      const sequence = await em.findOne(MetronomeSequence, {
        id: sequenceId,
        owner: user.id,
      });
      if (!sequence) {
        throw this.notFound();
      }

      const existing = await em.find(SectionMetronomeSequence, {
        sequence: sequenceId,
      });
      const existingSectionIds = new Set(
        existing.map((share) => share.section.id),
      );
      const wanted = new Set(sectionIds);
      const toAdd = sectionIds.filter((id) => !existingSectionIds.has(id));

      for (const sectionId of toAdd) {
        if (!(await this.canShareIn(user.id, sectionId))) {
          throw new ForbiddenException({
            code: 'CANNOT_SHARE_IN_SECTION',
            message: 'You cannot share sequences in this section',
          });
        }
      }

      for (const share of existing) {
        if (!wanted.has(share.section.id)) {
          em.remove(share);
        }
      }
      for (const sectionId of toAdd) {
        const share = new SectionMetronomeSequence();
        share.section = em.getReference(Section, sectionId);
        share.sequence = sequence;
        share.sharedBy = em.getReference(User, user.id);
        em.persist(share);
      }
    });

    const shared = await this.loadSharedSections(this.em.fork(), [sequenceId]);
    return shared.get(sequenceId) ?? [];
  }

  // Route already authorized for METRONOME_SEQUENCE_VIEW in this Section by
  // GroupPermissionsGuard.
  async listInSection(
    sectionId: string,
    viewerId: string,
    query: PaginationQuery,
  ): Promise<PaginatedResponse<SectionMetronomeSequenceResponseDto>> {
    const [shares, totalItems] = await this.em.findAndCount(
      SectionMetronomeSequence,
      { section: sectionId },
      {
        populate: ['sequence.owner'],
        orderBy: { createdAt: 'desc', id: 'asc' },
        limit: query.limit,
        offset: (query.page - 1) * query.limit,
      },
    );
    const canRemove = await this.canShareIn(viewerId, sectionId);

    return {
      data: shares.map((share) =>
        toSectionMetronomeSequenceResponseDto(share, viewerId, canRemove),
      ),
      meta: createPaginationMeta({
        page: query.page,
        limit: query.limit,
        totalItems,
      }),
    };
  }

  // Route already authorized for METRONOME_SEQUENCE_SHARE in this Section.
  // Removes only the link - the author's sequence and members' copies stay.
  async removeFromSection(
    sectionId: string,
    sequenceId: string,
  ): Promise<void> {
    const removed = await this.em.nativeDelete(SectionMetronomeSequence, {
      section: sectionId,
      sequence: sequenceId,
    });
    if (removed === 0) {
      throw this.notFound();
    }
  }

  // "Zapisz u siebie": an independent private copy of a sequence shared in
  // this Section (route already authorized for METRONOME_SEQUENCE_VIEW).
  // Concurrent requests for the same user and source (a double tap) are
  // serialized, and an identical copy that already exists is returned
  // instead of making another.
  async copyFromSection(
    user: User,
    sectionId: string,
    sequenceId: string,
  ): Promise<SaveResult> {
    const result = await this.em.transactional(async (em) => {
      await em
        .getConnection()
        .execute('select pg_advisory_xact_lock(hashtext(?))', [
          `metronome-copy:${user.id}:${sequenceId}`,
        ]);

      const share = await em.findOne(
        SectionMetronomeSequence,
        { section: sectionId, sequence: sequenceId },
        { populate: ['sequence.owner', 'sequence.originalAuthor'] },
      );
      // Not shared here answers exactly like a missing sequence.
      if (!share) {
        throw this.notFound();
      }
      const source = share.sequence;

      const previousCopies = await em.find(MetronomeSequence, {
        owner: user.id,
        copiedFrom: source.id,
      });
      const identical = previousCopies.find(
        (copy) =>
          copy.title === source.title &&
          copy.instrument === source.instrument &&
          copy.bpm === source.bpm &&
          copy.division === source.division &&
          JSON.stringify(copy.steps) === JSON.stringify(source.steps),
      );
      if (identical) {
        return { id: identical.id, created: false };
      }

      await this.assertBelowLimit(em, user.id);
      const copy = new MetronomeSequence();
      copy.owner = em.getReference(User, user.id);
      copy.title = source.title;
      copy.instrument = source.instrument;
      copy.bpm = source.bpm;
      copy.division = source.division;
      copy.steps = source.steps.map(({ sound, muted }) => ({ sound, muted }));
      copy.copiedFrom = source;
      // A copy of a copy still credits the person who made it first.
      copy.originalAuthor = source.originalAuthor ?? source.owner;
      em.persist(copy);
      return { id: copy.id, created: true };
    });

    return {
      sequence: await this.getOwned(user.id, result.id),
      created: result.created,
    };
  }

  // --- Helpers ------------------------------------------------------------

  private async canShareIn(
    userId: string,
    sectionId: string,
  ): Promise<boolean> {
    const authorization =
      await this.roleAssignmentsService.resolveAuthorization(sectionId, userId);
    if (
      !authorization ||
      !(authorization.community instanceof Section) ||
      authorization.community.status !== GroupStatus.ACTIVE
    ) {
      return false;
    }

    return this.groupPermissionService.hasAllPermissionsForRoles(
      'SECTION',
      authorization.roleAssignments.map((assignment) => assignment.role),
      [GroupPermission.METRONOME_SEQUENCE_SHARE],
      authorization.membership?.status ?? null,
    );
  }

  private async loadSharedSections(
    em: EntityManager,
    sequenceIds: string[],
  ): Promise<Map<string, MetronomeSequenceSectionDto[]>> {
    const bySequence = new Map<string, MetronomeSequenceSectionDto[]>();
    if (sequenceIds.length === 0) {
      return bySequence;
    }

    const shares = await em.find(
      SectionMetronomeSequence,
      { sequence: { $in: sequenceIds } },
      { populate: ['section'] },
    );
    for (const share of shares) {
      const list = bySequence.get(share.sequence.id) ?? [];
      list.push(toSectionDto(share.section));
      bySequence.set(share.sequence.id, list);
    }
    for (const list of bySequence.values()) {
      list.sort(byName);
    }

    return bySequence;
  }

  private async getOwned(
    userId: string,
    id: string,
  ): Promise<MetronomeSequenceResponseDto> {
    const em = this.em.fork();
    const sequence = await em.findOne(
      MetronomeSequence,
      { id, owner: userId },
      { populate: ['originalAuthor'] },
    );
    if (!sequence) {
      throw this.notFound();
    }
    const shared = await this.loadSharedSections(em, [id]);
    return toMetronomeSequenceResponseDto(sequence, shared.get(id) ?? []);
  }

  private async assertBelowLimit(
    em: EntityManager,
    userId: string,
  ): Promise<void> {
    const count = await em.count(MetronomeSequence, { owner: userId });
    if (count >= METRONOME_MAX_SEQUENCES_PER_USER) {
      throw new ConflictException(
        `A user can keep at most ${METRONOME_MAX_SEQUENCES_PER_USER} sequences`,
      );
    }
  }

  private notFound(): NotFoundException {
    return new NotFoundException('Metronome sequence not found');
  }
}
