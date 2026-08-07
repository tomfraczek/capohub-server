import { CareerTimelineItemDto } from './career-timeline-item.dto';

export interface CareerTimelineResponseDto {
  items: CareerTimelineItemDto[];
  total: number;
  hasMore: boolean;
}
