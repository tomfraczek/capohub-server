import { z, ZodSchema } from 'zod';

export interface ZodDto<T> {
  new (): T;
  schema: ZodSchema<T>;
}

/**
 * Turns a Zod schema into a class usable as a NestJS DTO type.
 * Pair it with ZodValidationPipe, e.g.:
 *   class CreateFooDto extends createZodDto(createFooSchema) {}
 *   @UsePipes(new ZodValidationPipe(CreateFooDto.schema))
 */
export function createZodDto<T extends ZodSchema>(
  schema: T,
): ZodDto<z.infer<T>> {
  class ZodDtoClass {
    static schema = schema;
  }

  return ZodDtoClass as unknown as ZodDto<z.infer<T>>;
}
