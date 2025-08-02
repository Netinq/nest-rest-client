import 'reflect-metadata';

export const PATH_PARAM_METADATA = 'PATH_PARAM_METADATA';
export const PAYLOAD_METADATA = 'PAYLOAD_METADATA';
export const QUERY_PARAM_METADATA = 'QUERY_PARAM_METADATA';

export function PathParam(name: string): ParameterDecorator {
  return (target, propertyKey, parameterIndex) => {
    if (propertyKey === undefined) {
      throw new Error('@PathParam can only be used on a method.');
    }

    const existing: { name: string; index: number }[] =
      Reflect.getMetadata(PATH_PARAM_METADATA, target, propertyKey) || [];

    existing.push({ name, index: parameterIndex });

    Reflect.defineMetadata(PATH_PARAM_METADATA, existing, target, propertyKey);
  };
}

export function Payload(): ParameterDecorator {
  return (target, propertyKey, parameterIndex) => {
    if (propertyKey === undefined) {
      throw new Error('@Payload can only be used on a method.');
    }

    Reflect.defineMetadata(
      PAYLOAD_METADATA,
      parameterIndex,
      target,
      propertyKey,
    );
  };
}

export function QueryParam(name: string): ParameterDecorator {
  return (target, propertyKey, parameterIndex) => {
    if (propertyKey === undefined) {
      throw new Error('@QueryParam can only be used on a method.');
    }

    const existing: { name: string; index: number }[] =
      Reflect.getMetadata(QUERY_PARAM_METADATA, target, propertyKey) || [];

    existing.push({ name, index: parameterIndex });

    Reflect.defineMetadata(QUERY_PARAM_METADATA, existing, target, propertyKey);
  };
}
