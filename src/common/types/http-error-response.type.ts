export interface HttpFieldError {
  field: string;
  message: string;
}

export interface HttpErrorResponse {
  statusCode: number;
  code: string;
  message: string;
  errors?: HttpFieldError[];
  path: string;
  timestamp: string;
}
