import 'reflect-metadata';

export * from './client';
export * from './client.module';
export * from './decorators/methods';
export * from './decorators/requestContext';
export * from './decorators/resilience';
export * from './factory/client.factory';
export * from './interfaces/auth.interface';
export * from './types/endpoint';

export {
  RestClient,
  Returns,
  ContentType,
  ClassTransformOptions,
  ReturnMetadata,
  REST_CLIENT_METADATA,
  REST_CLIENT_CONTENT_TYPE,
  RETURNS_METADATA,
  // `RestClientOptions` est déjà pris par les options du module.
  RestClientOptions as RestClientDecoratorOptions,
} from './decorators/rest';

export { default as ContentTypes } from './constants/ContentTypes';
