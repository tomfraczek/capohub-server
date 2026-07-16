import { TagResponseDto } from '../dto/tag-response.dto';
import { Tag } from '../entities/tag.entity';

export function toTagResponseDto(tag: Tag): TagResponseDto {
  return {
    id: tag.id,
    name: tag.name,
    slug: tag.slug,
  };
}
