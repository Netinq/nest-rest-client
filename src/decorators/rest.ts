import 'reflect-metadata';
import ContentTypes from '../constants/ContentTypes';
import {ClassTransformOptions} from 'class-transformer';

export const REST_CLIENT_METADATA = 'REST_CLIENT_METADATA';
export const RETURNS_METADATA = 'restclient:returntype';
export const REST_CLIENT_CONTENT_TYPE = 'REST_CLIENT_CONTENT_TYPE';

export interface RestClientOptions {
  url: () => string;
}

export interface ReturnMetadata {
  dto: any;
  classTransformOptions?: ClassTransformOptions
}

export function RestClient(options: RestClientOptions): ClassDecorator {
  return (target) => {
    Reflect.defineMetadata(REST_CLIENT_METADATA, options, target);
  };
}

export function Returns(dto: ReturnMetadata['dto'], classTransformOptions?: ReturnMetadata['classTransformOptions']): MethodDecorator {
  return (target, propertyKey, descriptor) => {
    Reflect.defineMetadata(RETURNS_METADATA, {
      dto,
      classTransformOptions: classTransformOptions || { excludeExtraneousValues: true },
    }, target, propertyKey);
  };
}

export function ContentType(type: ContentTypes): MethodDecorator {
  return (target, propertyKey, descriptor) => {
    Reflect.defineMetadata(REST_CLIENT_CONTENT_TYPE, type, target);
  };
}
