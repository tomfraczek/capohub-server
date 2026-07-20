import { Section } from '../entities/section.entity';
import { SectionResponseDto } from '../dto/section-response.dto';

export function toSectionResponseDto(section: Section): SectionResponseDto {
  return {
    id: section.id,
    groupId: section.group.id,
    name: section.name,
    description: section.description,
    status: section.status,
    createdAt: section.createdAt.toISOString(),
    updatedAt: section.updatedAt.toISOString(),
  };
}
