import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EntityManager } from '@mikro-orm/postgresql';
import { AuditLogService } from '../groups/audit-log.service';
import { AuditAction } from '../groups/enums/audit-action.enum';
import { AuditTargetType } from '../groups/enums/audit-target-type.enum';
import { Group } from '../groups/entities/group.entity';
import { User } from '../users/entities/user.entity';
import { GraduationSystemResponseDto } from './dto/graduation-system-response.dto';
import { GraduationSystem } from './entities/graduation-system.entity';
import { toGraduationSystemResponseDto } from './mappers/graduation-system.mapper';

// GraduationSystem existence/status of its owning Group, and that the
// caller is OWNER/ADMIN of *that exact Group* (never a Section, never
// inherited), is already enforced by GroupPermissionsGuard (via :groupId +
// @RequireGroupKind(GroupKind.ROOT), see graduation-system.controller.ts)
// before any handler here runs.
@Injectable()
export class GraduationSystemService {
  constructor(
    private readonly em: EntityManager,
    private readonly auditLogService: AuditLogService,
  ) {}

  /**
   * Returns the Group's single active system. A Group without one is a
   * valid, permanent state (see the module spec) - callers distinguish
   * "not created yet" from a real error the same way every other singular
   * sub-resource in this codebase does (Academy, RecipientGroup, ...): a
   * 404, not a 200 with an empty/null body (which NestJS's Express adapter
   * cannot send as a literal JSON `null` anyway - returning null/undefined
   * from a handler sends an empty body, not the text "null").
   */
  async getByGroup(groupId: string): Promise<GraduationSystemResponseDto> {
    const system = await this.loadActive(groupId);
    if (!system) {
      throw this.notFound();
    }
    return toGraduationSystemResponseDto(system);
  }

  // No input - a Group has exactly one catalog and the system carries no
  // settings of its own (no name - see graduation-system.entity.ts).
  async create(
    groupId: string,
    actor: User,
  ): Promise<GraduationSystemResponseDto> {
    const existing = await this.loadActive(groupId);
    if (existing) {
      throw new ConflictException({
        code: 'GRADUATION_SYSTEM_ALREADY_EXISTS',
        message: 'This group already has an active graduation system',
      });
    }

    const group = this.em.getReference(Group, groupId);
    const system = new GraduationSystem();
    system.group = group;

    this.auditLogService.record(this.em, {
      community: group,
      action: AuditAction.CREATE_GRADUATION_SYSTEM,
      actor,
      targetType: AuditTargetType.GRADUATION_SYSTEM,
      targetId: system.id,
    });

    await this.em.persist(system).flush();
    return toGraduationSystemResponseDto(system);
  }

  private async loadActive(groupId: string): Promise<GraduationSystem | null> {
    return this.em.findOne(
      GraduationSystem,
      { group: groupId, isActive: true },
      { populate: ['group'] },
    );
  }

  private notFound(): NotFoundException {
    return new NotFoundException({
      code: 'GRADUATION_SYSTEM_NOT_FOUND',
      message: 'This group has no active graduation system',
    });
  }
}
