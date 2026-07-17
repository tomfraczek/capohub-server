export interface HttpFieldError {
  field: string;
  message: string;
}

export interface HttpErrorResponse {
  statusCode: number;
  code: string;
  message: string;
  errors?: HttpFieldError[];
  // Opaque structured detail list for error codes that need more than a
  // message - currently only DUPLICATE_SONG (POST /songs/:id/submit),
  // which attaches the matched DuplicateSongSuggestionDto[] candidates.
  // Kept untyped here to avoid this shared/common type depending on a
  // feature module's DTOs.
  duplicates?: unknown[];
  path: string;
  timestamp: string;
}
