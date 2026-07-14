import { PaginationMeta } from './pagination.types';

interface CreatePaginationMetaParams {
  page: number;
  limit: number;
  totalItems: number;
}

export function createPaginationMeta({
  page,
  limit,
  totalItems,
}: CreatePaginationMetaParams): PaginationMeta {
  const totalPages = totalItems === 0 ? 0 : Math.ceil(totalItems / limit);

  return {
    page,
    limit,
    totalItems,
    totalPages,
    hasNextPage: page < totalPages,
    hasPreviousPage: page > 1,
  };
}
