import 'reflect-metadata';
import {RestAuth} from './interfaces/auth.interface';
import {REST_CLIENT_CONTENT_TYPE, REST_CLIENT_METADATA, ReturnMetadata, RETURNS_METADATA} from './decorators/rest';
import {Logger, Type} from '@nestjs/common';
import axios, {AxiosHeaders, AxiosRequestConfig, AxiosResponse, RawAxiosRequestHeaders} from 'axios';
import {plainToInstance} from 'class-transformer';
import {METHOD_METADATA} from './decorators/methods';
import {PATH_PARAM_METADATA, PAYLOAD_METADATA, QUERY_PARAM_METADATA} from './decorators/requestContext';
import {MethodMetadata} from './types/decorators/methods';

export const LOGGER = new Logger('NestRestClient');

function replacePathVariables(path: string, variables: Record<string, any>) {
  return path.replace(/:([a-zA-Z0-9_]+)/g, (_, key) => {
    if (variables[key] === undefined) {
      throw new Error(`Missing path variable: ${key}`);
    }
    return encodeURIComponent(String(variables[key]));
  });
}

async function populateAxiosConfig({
  axiosConfig,
  auth,
  classRef,
}: {
  axiosConfig: AxiosRequestConfig;
  auth?: RestAuth;
  classRef: new (...args: any[]) => any;
}): Promise<AxiosRequestConfig> {

  const headers = { ...(axiosConfig.headers || {}) };

  if (auth) {
    const token = await auth.getToken();
    if (!token) {
      throw new Error('No token provided by auth service');
    }
    headers['Authorization'] = `Bearer ${token}`;
  }

  const metaContentType = Reflect.getMetadata(REST_CLIENT_CONTENT_TYPE, classRef.prototype);

  if (!metaContentType) {
    LOGGER.warn('No content type defined for REST client, defaulting to application/json');
    headers['Content-Type'] = 'application/json';
  } else {
    headers['Content-Type'] = metaContentType;
  }

  return {
    ...axiosConfig,
    headers,
  };
}

export function createNestRestClient<T extends object>(
  classRef: Type<T>,
  auth?: RestAuth,
): T {

  const meta = Reflect.getMetadata(REST_CLIENT_METADATA, classRef);

  if (!meta) {
    throw new Error('Could not initialize rest client, @RestClient() not found on class ' + classRef.name);
  }

  const baseUrl = typeof meta.url === 'function' ? meta.url() : meta.url;

  async function doRequest(
    axiosConfig: any,
    returnTypeMetadata: ReturnMetadata | undefined = undefined,
    retry = true,
  ): Promise<any> {
    axiosConfig = await populateAxiosConfig({
      axiosConfig,
      auth,
      classRef,
    });

    try {
      const response: AxiosResponse = await axios(axiosConfig);
      if (returnTypeMetadata) {
        return plainToInstance(returnTypeMetadata.dto, response.data, returnTypeMetadata.classTransformOptions);
      }
      return response.data;
    } catch (error: any) {
      if (retry) {
        if (error.response?.status === 401 && auth?.refreshToken) {
          LOGGER.warn('Unauthorized request, attempting to refresh token');
          await auth.refreshToken();
          return doRequest(axiosConfig, returnTypeMetadata, false); // retry une seule fois
        }
      }
      LOGGER.error('Error during REST request', error);
      throw error;
    }
  }

  const methodMetadataCache = new Map<
    string,
    {
      methodMeta: MethodMetadata;
      returnTypeMetadata?: ReturnMetadata;
      pathParamMeta: Array<{ name: string; index: number }>;
      queryParamMeta: Array<{ name: string; index: number }>;
      payloadIndex?: number;
    }
  >();

  return new Proxy({} as T, {
    get(_, prop: string) {
      if (!methodMetadataCache.has(prop)) {
        const methodMeta: MethodMetadata = Reflect.getMetadata(
          METHOD_METADATA,
          classRef.prototype,
          prop,
        );
        if (!methodMeta) return undefined;

        const returnTypeMetadata: ReturnMetadata | undefined = Reflect.getMetadata(
          RETURNS_METADATA,
          classRef.prototype,
          prop,
        );

        const pathParamMeta: Array<{ name: string; index: number }> =
          Reflect.getMetadata(PATH_PARAM_METADATA, classRef.prototype, prop) ||
          [];
        const queryParamMeta: Array<{ name: string; index: number }> =
          Reflect.getMetadata(QUERY_PARAM_METADATA, classRef.prototype, prop) ||
          [];
        const payloadIndex: number | undefined = Reflect.getMetadata(
          PAYLOAD_METADATA,
          classRef.prototype,
          prop,
        );

        methodMetadataCache.set(prop, {
          methodMeta,
          returnTypeMetadata,
          pathParamMeta,
          queryParamMeta,
          payloadIndex,
        });
      }

      const {
        methodMeta,
        returnTypeMetadata,
        pathParamMeta,
        queryParamMeta,
        payloadIndex,
      } = methodMetadataCache.get(prop)!;

      const endpoint = classRef.prototype[prop];

      if (!endpoint) return undefined;
      if (!methodMeta) return undefined;

      return async (...args: any[]) => {
        const pathVariables: Record<string, any> = {};
        for (const { name, index } of pathParamMeta) {
          if (args[index] === undefined) {
            throw new Error(`Missing path variable: ${name}`);
          }
          pathVariables[name] = args[index];
        }

        const payload = payloadIndex !== undefined ? args[payloadIndex] : undefined;
        const url = baseUrl + replacePathVariables(methodMeta.path, pathVariables);

        const axiosConfig: AxiosRequestConfig = {
          method: methodMeta.method,
          url
        }

        if (methodMeta.method.toUpperCase() === 'GET') {
          axiosConfig.params = {
            ...queryParamMeta,
          };
          if (payload) {
            LOGGER.warn('GET request with payload, using as query parameters instead');
            axiosConfig.params = {
              ...(axiosConfig.params || {}),
              ...payload,
            };
          }
        } else {
          if (payload) {
            axiosConfig.data = payload;
          }
        }

        return doRequest(axiosConfig, returnTypeMetadata);
      }
    }
  });

}
