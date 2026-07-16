import { SongCategoryResponseDto } from '../dto/song-category-response.dto';
import { SongCategory } from '../entities/song-category.entity';

export function toSongCategoryResponseDto(
  category: SongCategory,
): SongCategoryResponseDto {
  return {
    id: category.id,
    code: category.code,
    name: category.name,
    position: category.position,
  };
}
