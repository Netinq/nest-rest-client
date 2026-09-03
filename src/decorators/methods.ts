import 'reflect-metadata';
import { EndpointDecorator } from '../types/endpoint';

export const METHOD_METADATA = 'METHOD_METADATA';
export const ENDPOINTS_METADATA = 'REST_CLIENT:ENDPOINTS';

export interface MethodMetadata {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'HEAD' | 'OPTIONS';
  path: string;
}

function registerEndpoint(target: any, propertyKey: string | symbol) {
  const own: (string | symbol)[] =
    Reflect.getOwnMetadata(ENDPOINTS_METADATA, target) ??
    [...(Reflect.getMetadata(ENDPOINTS_METADATA, target) ?? [])];

  if (!own.includes(propertyKey)) {
    own.push(propertyKey);
  }

  Reflect.defineMetadata(ENDPOINTS_METADATA, own, target);
}

function createMethodDecorator(method: MethodMetadata['method']) {
  return (path: string): EndpointDecorator => {
    return (target, propertyKey) => {
      Reflect.defineMetadata(
        METHOD_METADATA,
        { method, path },
        target,
        propertyKey,
      );
      registerEndpoint(target, propertyKey);
    };
  };
}

export const Get = createMethodDecorator('GET');
export const Post = createMethodDecorator('POST');
export const Put = createMethodDecorator('PUT');
export const Delete = createMethodDecorator('DELETE');
export const Patch = createMethodDecorator('PATCH');
export const Head = createMethodDecorator('HEAD');
export const Options = createMethodDecorator('OPTIONS');
