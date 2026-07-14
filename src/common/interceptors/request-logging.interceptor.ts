import {
  CallHandler,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { Observable, throwError } from 'rxjs';
import { catchError, tap } from 'rxjs/operators';

@Injectable()
export class RequestLoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<Request>();
    const response = context.switchToHttp().getResponse<Response>();
    const { method, originalUrl } = request;
    const startTime = Date.now();

    return next.handle().pipe(
      tap(() => {
        this.log(method, originalUrl, response.statusCode, startTime);
      }),
      catchError((error: unknown) => {
        const status =
          error instanceof HttpException
            ? error.getStatus()
            : HttpStatus.INTERNAL_SERVER_ERROR;
        this.log(method, originalUrl, status, startTime);
        return throwError(() => error);
      }),
    );
  }

  private log(
    method: string,
    url: string,
    statusCode: number,
    startTime: number,
  ): void {
    const duration = Date.now() - startTime;
    this.logger.log(`${method} ${url} ${statusCode} ${duration}ms`);
  }
}
