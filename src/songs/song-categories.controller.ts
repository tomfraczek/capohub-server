import { Controller, Get } from '@nestjs/common';
import { SongCategoryResponseDto } from './dto/song-category-response.dto';
import { toSongCategoryResponseDto } from './mappers/song-category.mapper';
import { SongCategoriesService } from './song-categories.service';

@Controller('song-categories')
export class SongCategoriesController {
  constructor(private readonly songCategoriesService: SongCategoriesService) {}

  @Get()
  async list(): Promise<{ data: SongCategoryResponseDto[] }> {
    const categories = await this.songCategoriesService.listActive();
    return { data: categories.map(toSongCategoryResponseDto) };
  }
}
