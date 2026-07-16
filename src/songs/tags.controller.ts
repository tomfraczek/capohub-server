import { Controller, Get, Query } from '@nestjs/common';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { TagsQueryDto, tagsQuerySchema } from './dto/tags-query.schema';
import { TagResponseDto } from './dto/tag-response.dto';
import { toTagResponseDto } from './mappers/tag.mapper';
import { TagsService } from './tags.service';

@Controller('tags')
export class TagsController {
  constructor(private readonly tagsService: TagsService) {}

  @Get()
  async list(
    @Query(new ZodValidationPipe(tagsQuerySchema)) query: TagsQueryDto,
  ): Promise<{ data: TagResponseDto[] }> {
    const tags = await this.tagsService.search(query.search, query.limit);
    return { data: tags.map(toTagResponseDto) };
  }
}
