import { StandardSchemaSerializerInterceptor, StreamableFile } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';

type SerializeArguments = Parameters<StandardSchemaSerializerInterceptor['serialize']>;

/**
 * Answers each route through its contract schema (`@SerializeOptions({ schema })`): only the
 * schema's fields leave the server, and a response that breaks it is an internal error. Unlike
 * Nest's interceptor, an array response is checked as a whole against the schema, which is the
 * list schema itself, not item by item; a file (`StreamableFile`) and an empty answer (204) pass
 * as they are. Provided with a factory: the base class declares injection tokens of its own.
 * Copied from Vertex Shifa.
 */
export class ContractSerializer extends StandardSchemaSerializerInterceptor {
  constructor(reflector: Reflector) {
    super(reflector);
  }

  override serialize(...[response, schema, validateOptions]: SerializeArguments) {
    if (!schema || typeof response !== 'object' || response === null) return response;
    if (response instanceof StreamableFile) return response;
    return this.transformToPlain(response, schema, validateOptions);
  }
}
