import {
  ArgumentsHost,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { HttpExceptionFilter } from './http-exception.filter';
import type { HttpErrorResponse } from '../types/http-error-response.type';

function createHost(): {
  host: ArgumentsHost;
  json: jest.Mock<void, [HttpErrorResponse]>;
  status: jest.Mock;
} {
  const json = jest.fn<void, [HttpErrorResponse]>();
  const status = jest.fn().mockReturnValue({ json });
  const request = { method: 'GET', url: '/api/v1/example' };
  const response = { status };

  const host = {
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => response,
    }),
  } as unknown as ArgumentsHost;

  return { host, json, status };
}

describe('HttpExceptionFilter', () => {
  it('formats a validation error thrown by ZodValidationPipe', () => {
    const filter = new HttpExceptionFilter();
    const { host, json, status } = createHost();

    const exception = new BadRequestException({
      code: 'VALIDATION_ERROR',
      message: 'Validation failed',
      errors: [{ field: 'email', message: 'Invalid email' }],
    });

    filter.catch(exception, host);

    expect(status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 400,
        code: 'VALIDATION_ERROR',
        message: 'Validation failed',
        errors: [{ field: 'email', message: 'Invalid email' }],
        path: '/api/v1/example',
      }),
    );
  });

  it('formats a built-in NotFoundException without leaking internals', () => {
    const filter = new HttpExceptionFilter();
    const { host, json, status } = createHost();

    filter.catch(new NotFoundException('Resource not found'), host);

    expect(status).toHaveBeenCalledWith(404);
    const body = json.mock.calls[0][0];
    expect(body.code).toBe('NOT_FOUND');
    expect(body.message).toBe('Resource not found');
    expect(body.errors).toBeUndefined();
  });

  it('maps unknown errors to a safe 500 response', () => {
    const filter = new HttpExceptionFilter();
    const { host, json, status } = createHost();

    filter.catch(new Error('some internal detail'), host);

    expect(status).toHaveBeenCalledWith(500);
    const body = json.mock.calls[0][0];
    expect(body.code).toBe('INTERNAL_SERVER_ERROR');
    expect(body.message).toBe('Internal server error');
    expect(body.message).not.toContain('some internal detail');
  });
});
