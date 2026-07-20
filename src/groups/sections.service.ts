import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EntityManager } from '@mikro-orm/postgresql';
import { CreateSectionInput } from './dto/create-section.schema';
import { SectionResponseDto } from './dto/section-response.dto';
import { UpdateSectionInput } from './dto/update-section.schema';
import { Group } from './entities/group.entity';
import { Section } from './entities/section.entity';
import { SectionStatus } from './enums/section-status.enum';
import { toSectionResponseDto } from './mappers/section.mapper';

// A Group works identically with zero Sections (see ADR-003) - this
// service has no logic that depends on whether any Section exists.
// Section existence/status of its *Group* is already enforced by
// GroupPermissionsGuard (via :groupId) before any handler here runs.
@Injectable()
export class SectionsService {
  constructor(private readonly em: EntityManager) {}

  async create(
    groupId: string,
    input: CreateSectionInput,
  ): Promise<SectionResponseDto> {
    const section = new Section();
    section.group = this.em.getReference(Group, groupId);
    this.applyFields(section, input);

    await this.em.persist(section).flush();
    return toSectionResponseDto(section);
  }

  async list(groupId: string): Promise<SectionResponseDto[]> {
    const sections = await this.em.find(
      Section,
      { group: groupId },
      { orderBy: { createdAt: 'asc' } },
    );
    return sections.map(toSectionResponseDto);
  }

  async getById(
    groupId: string,
    sectionId: string,
  ): Promise<SectionResponseDto> {
    const section = await this.loadOrFail(groupId, sectionId);
    return toSectionResponseDto(section);
  }

  async update(
    groupId: string,
    sectionId: string,
    input: UpdateSectionInput,
  ): Promise<SectionResponseDto> {
    const section = await this.loadOrFail(groupId, sectionId);
    this.assertIsWritable(section);
    this.applyFields(section, input);
    await this.em.flush();
    return toSectionResponseDto(section);
  }

  async archive(
    groupId: string,
    sectionId: string,
  ): Promise<SectionResponseDto> {
    const section = await this.loadOrFail(groupId, sectionId);
    this.assertIsWritable(section);
    section.status = SectionStatus.ARCHIVED;
    await this.em.flush();
    return toSectionResponseDto(section);
  }

  private assertIsWritable(section: Section): void {
    if (section.status === SectionStatus.ARCHIVED) {
      throw new ConflictException({
        code: 'SECTION_ARCHIVED',
        message:
          'This section is archived and is read-only until it is restored',
      });
    }
  }

  private applyFields(section: Section, input: CreateSectionInput): void {
    section.name = input.name;
    section.description = input.description;
  }

  private async loadOrFail(
    groupId: string,
    sectionId: string,
  ): Promise<Section> {
    const section = await this.em.findOne(
      Section,
      { id: sectionId, group: groupId },
      { populate: ['group'] },
    );
    if (!section) {
      throw new NotFoundException({
        code: 'SECTION_NOT_FOUND',
        message: 'Section not found',
      });
    }
    return section;
  }
}
