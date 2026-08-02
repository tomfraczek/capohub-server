import { Academy } from '../entities/academy.entity';
import { AcademyResponseDto } from '../dto/academy-response.dto';

export function toAcademyResponseDto(academy: Academy): AcademyResponseDto {
  return {
    id: academy.id,
    // `group`/`section` are the two nullable halves of Academy's
    // Group-or-Section reference (see academy.entity.ts) - exactly one is
    // ever set.
    groupId: (academy.group ?? academy.section)!.id,
    name: academy.name,
    address: academy.address,
    latitude: academy.latitude,
    longitude: academy.longitude,
    contactEmail: academy.contactEmail,
    contactPhone: academy.contactPhone,
    openingHours: academy.openingHours,
    photoUrls: academy.photoUrls,
    description: academy.description,
    status: academy.status,
    createdAt: academy.createdAt.toISOString(),
    updatedAt: academy.updatedAt.toISOString(),
  };
}
