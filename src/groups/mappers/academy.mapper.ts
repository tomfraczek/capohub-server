import { Academy } from '../entities/academy.entity';
import { AcademyResponseDto } from '../dto/academy-response.dto';

export function toAcademyResponseDto(academy: Academy): AcademyResponseDto {
  return {
    id: academy.id,
    groupId: academy.group.id,
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
