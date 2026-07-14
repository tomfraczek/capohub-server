import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';
import { ZodValidationPipe } from './zod-validation.pipe';

describe('ZodValidationPipe', () => {
  const schema = z.object({
    email: z.string().email(),
    age: z.number().int().positive(),
  });

  it('returns the parsed value when input is valid', () => {
    const pipe = new ZodValidationPipe(schema);
    const value = { email: 'user@example.com', age: 30 };

    expect(pipe.transform(value)).toEqual(value);
  });

  it('throws a BadRequestException with a field error list on invalid input', () => {
    expect.assertions(3);
    const pipe = new ZodValidationPipe(schema);

    try {
      pipe.transform({ email: 'not-an-email', age: -5 });
    } catch (error) {
      expect(error).toBeInstanceOf(BadRequestException);
      const response = (error as BadRequestException).getResponse() as {
        code: string;
        message: string;
        errors: { field: string; message: string }[];
      };

      expect(response.code).toBe('VALIDATION_ERROR');
      expect(response.errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ field: 'email' }),
          expect.objectContaining({ field: 'age' }),
        ]),
      );
    }
  });
});
