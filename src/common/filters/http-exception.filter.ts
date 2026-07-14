import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import {
  HttpErrorResponse,
  HttpFieldError,
} from '../types/http-error-response.type';

const DEFAULT_CODES_BY_STATUS: Record<number, string> = {
  [HttpStatus.BAD_REQUEST]: 'VALIDATION_ERROR',
  [HttpStatus.UNAUTHORIZED]: 'UNAUTHORIZED',
  [HttpStatus.FORBIDDEN]: 'FORBIDDEN',
  [HttpStatus.NOT_FOUND]: 'NOT_FOUND',
  [HttpStatus.INTERNAL_SERVER_ERROR]: 'INTERNAL_SERVER_ERROR',
  [HttpStatus.SERVICE_UNAVAILABLE]: 'SERVICE_UNAVAILABLE',
};

interface HttpExceptionBody {
  code?: unknown;
  message?: unknown;
  errors?: unknown;
}

function isHttpExceptionBody(value: unknown): value is HttpExceptionBody {
  return typeof value === 'object' && value !== null;
}

function fallbackCodeForStatus(status: number): string {
  return DEFAULT_CODES_BY_STATUS[status] ?? 'HTTP_ERROR';
}

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const { status, code, message, errors } =
      this.resolveExceptionDetails(exception);

    if (status >= Number(HttpStatus.INTERNAL_SERVER_ERROR)) {
      this.logger.error(
        `${request.method} ${request.url} ${status}`,
        exception instanceof Error ? exception.stack : undefined,
      );
    }

    const body: HttpErrorResponse = {
      statusCode: status,
      code,
      message,
      path: request.url,
      timestamp: new Date().toISOString(),
      ...(errors ? { errors } : {}),
    };

    response.status(status).json(body);
  }

  private resolveExceptionDetails(exception: unknown): {
    status: number;
    code: string;
    message: string;
    errors?: HttpFieldError[];
  } {
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const responseBody = exception.getResponse();

      if (isHttpExceptionBody(responseBody)) {
        const code =
          typeof responseBody.code === 'string'
            ? responseBody.code
            : fallbackCodeForStatus(status);

        const message = Array.isArray(responseBody.message)
          ? responseBody.message.join(', ')
          : typeof responseBody.message === 'string'
            ? responseBody.message
            : exception.message;

        const errors = Array.isArray(responseBody.errors)
          ? (responseBody.errors as HttpFieldError[])
          : undefined;

        return { status, code, message, errors };
      }

      return {
        status,
        code: fallbackCodeForStatus(status),
        message:
          typeof responseBody === 'string' ? responseBody : exception.message,
      };
    }

    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      code: 'INTERNAL_SERVER_ERROR',
      message: 'Internal server error',
    };
  }
}
