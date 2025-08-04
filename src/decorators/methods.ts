import 'reflect-metadata';
import { MethodMetadata, HttpMethod, RestMethodDecorator } from '../types/decorators/methods';

export const METHOD_METADATA = Symbol('METHOD_METADATA');

function createMethodDecorator(method: HttpMethod): RestMethodDecorator {
  return (path: string): MethodDecorator => {
    return (
      target: Object,
      propertyKey: string | symbol,
      descriptor: PropertyDescriptor
    ) => {
      Reflect.defineMetadata(
        METHOD_METADATA,
        { method, path },
        target,
        propertyKey
      );
    };
  };
}

export const Get = createMethodDecorator('GET');
export const Post = createMethodDecorator('POST');
export const Put = createMethodDecorator('PUT');
export const Delete = createMethodDecorator('DELETE');
export const Patch = createMethodDecorator('PATCH');
