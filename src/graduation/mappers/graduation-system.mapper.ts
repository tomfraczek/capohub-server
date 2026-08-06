import { GraduationSystemResponseDto } from '../dto/graduation-system-response.dto';
import { GraduationSystem } from '../entities/graduation-system.entity';

export function toGraduationSystemResponseDto(
  system: GraduationSystem,
): GraduationSystemResponseDto {
  return {
    id: system.id,
    groupId: system.group.id,
    name: system.name,
    isActive: system.isActive,
    createdAt: system.createdAt.toISOString(),
    updatedAt: system.updatedAt.toISOString(),
  };
}
