import { BadRequestException, type PipeTransform } from '@nestjs/common';
import type { SchemaObject } from '@nestjs/swagger';
import { z } from 'zod';

/** Validates a body/query/param with a shared Zod schema: `@Body(new ZodPipe(schema))`. */
export class ZodPipe<T extends z.ZodType> implements PipeTransform<unknown, z.output<T>> {
  constructor(private readonly schema: T) {}

  transform(value: unknown): z.output<T> {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new BadRequestException({
        message: 'Validation failed',
        issues: result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      });
    }
    return result.data;
  }
}

/** Swagger schema straight from the Zod schema, so docs and validation never drift. */
export const apiSchema = (schema: z.ZodType) =>
  z.toJSONSchema(schema, {
    target: 'openapi-3.0',
    io: 'input',
    unrepresentable: 'any',
  }) as SchemaObject;
