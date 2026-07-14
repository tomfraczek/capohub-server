import { BadRequestException, PipeTransform } from '@nestjs/common';
import { ZodSchema } from 'zod';
import { HttpFieldError } from '../types/http-error-response.type';

export class ZodValidationPipe implements PipeTransform {
  constructor(private readonly schema: ZodSchema) {}

  transform(value: unknown): unknown {
    const result = this.schema.safeParse(value);

    if (!result.success) {
      const errors: HttpFieldError[] = result.error.issues.map((issue) => ({
        field: issue.path.join('.') || '(root)',
        message: issue.message,
      }));

      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'Validation failed',
        errors,
      });
    }

    return result.data;
  }
}
