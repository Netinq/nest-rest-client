import 'reflect-metadata';

export const METHOD_METADATA = 'METHOD_METADATA';

export interface MethodMetadata {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'HEAD' | 'OPTIONS';
  path: string;
}

function createMethodDecorator(method: MethodMetadata['method']) {
  return (path: string): MethodDecorator => {
    return (target, propertyKey) => {
      Reflect.defineMetadata(
        METHOD_METADATA,
        { method, path },
        target,
        propertyKey,
      );
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
