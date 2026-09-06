import 'reflect-metadata';
import ContentTypes from '../constants/ContentTypes';
import {ClassConstructor, ClassTransformOptions} from 'class-transformer';
import {EndpointDecorator} from '../types/endpoint';

export const REST_CLIENT_METADATA = 'REST_CLIENT_METADATA';
export const RETURNS_METADATA = 'REST_CLIENT:RETURN_TYPE';
export const REST_CLIENT_CONTENT_TYPE = 'REST_CLIENT:CONTENT_TYPE';
export const REST_CLIENT_METHOD_CONTENT_TYPE = 'REST_CLIENT:METHOD_CONTENT_TYPE';

const defaultClassTransformOptions: ClassTransformOptions = {
  excludeExtraneousValues: true,
};

export interface RestClientOptions {
  url: string | (() => string);
  headers?: Record<string, string>;
  contentType?: ContentTypes | string;
}

export interface ReturnMetadata {
  dto: ClassConstructor<any>;
  classTransformOptions: ClassTransformOptions
}

export function RestClient(options: RestClientOptions): ClassDecorator {
  return (target) => {
    Reflect.defineMetadata(REST_CLIENT_METADATA, {
      ...options,
      headers: options.headers || {},
      contentType: options.contentType,
    }, target);
  };
}

export function Returns(dto: ReturnMetadata['dto'], classTransformOptions: ReturnMetadata['classTransformOptions'] = defaultClassTransformOptions): EndpointDecorator {
  return (target, propertyKey, descriptor) => {
    Reflect.defineMetadata(RETURNS_METADATA, {
      dto,
      classTransformOptions: classTransformOptions
    }, target, propertyKey);
  };
}


export function ClassTransformOptions(classTransformOptions: ClassTransformOptions): EndpointDecorator {
  return (target, propertyKey, descriptor) => {
    Reflect.defineMetadata(RETURNS_METADATA, classTransformOptions, target, propertyKey);
  };
}

export function ContentType(type: ContentTypes | string): ClassDecorator & MethodDecorator {
  return (target: any, propertyKey?: string | symbol) => {
    if (propertyKey !== undefined && propertyKey !== null) {
      Reflect.defineMetadata(REST_CLIENT_METHOD_CONTENT_TYPE, type, target, propertyKey);
      return;
    }

    Reflect.defineMetadata(REST_CLIENT_CONTENT_TYPE, type, target);
  };
}
