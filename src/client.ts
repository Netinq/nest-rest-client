import 'reflect-metadata';
import {RestAuth} from './interfaces/auth.interface';
import {REST_CLIENT_CONTENT_TYPE, REST_CLIENT_METADATA, ReturnMetadata, RETURNS_METADATA} from './decorators/rest';
import {Logger, Type} from '@nestjs/common';
import axios, {AxiosRequestConfig, AxiosResponse} from 'axios';
import {plainToInstance} from 'class-transformer';
import {ENDPOINTS_METADATA, METHOD_METADATA, MethodMetadata} from './decorators/methods';
import {PATH_PARAM_METADATA, PAYLOAD_METADATA, QUERY_PARAM_METADATA} from './decorators/requestContext';
import {RestClientConfig} from './client.module';

export const LOGGER = new Logger('NestRestClient');

function replacePathVariables(path: string, variables: Record<string, any>) {
  return path.replace(/:([a-zA-Z0-9_]+)/g, (_, key) => {
    if (variables[key] === undefined) {
      throw new Error(`Missing path variable: ${key}`);
    }
    return encodeURIComponent(String(variables[key]));
  });
}

function getAllRestMethods(classRef: any): string[] {
  const endpoints: (string | symbol)[] =
    Reflect.getMetadata(ENDPOINTS_METADATA, classRef.prototype) ?? [];

  return endpoints.filter((key): key is string => typeof key === 'string');
}

function extractPathPlaceholders(path: string): string[] {
  return (path.match(/:([a-zA-Z0-9_]+)/g) || []).map((match) => match.slice(1));
}

async function populateAxiosConfig({
  axiosConfig,
  config,
  auth,
  classRef,
}: {
  axiosConfig: AxiosRequestConfig;
  config?: RestClientConfig;
  auth?: RestAuth;
  classRef: new (...args: any[]) => any;
}): Promise<AxiosRequestConfig> {

  const headers = { ...(axiosConfig.headers || {}) };

  if (config?.headers) {
    Object.assign(headers, config.headers);
  }

  if (auth) {
    const token = await auth.getToken();
    if (!token) {
      throw new Error('No token provided by auth service');
    }
    headers['Authorization'] = `Bearer ${token}`;
  }
  LOGGER.debug(headers);
  const metaContentType = Reflect.getMetadata(REST_CLIENT_CONTENT_TYPE, classRef);

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
  config?: RestClientConfig,
  auth?: RestAuth,
): T {

  LOGGER.debug('Creating nest client', auth);

  const meta = Reflect.getMetadata(REST_CLIENT_METADATA, classRef);

  if (!meta) {
    throw new Error('Could not initialize rest client, @RestClient() not found on class ' + classRef.name);
  }

  const baseUrl = typeof meta.url === 'function' ? meta.url() : meta.url;

  LOGGER.log(`Creating REST client for ${classRef.name} (${baseUrl})`);
  const methodNames = getAllRestMethods(classRef);

  for (const methodName of methodNames) {
    const methodMeta = Reflect.getMetadata(METHOD_METADATA, classRef.prototype, methodName);
    const returnTypeMeta = Reflect.getMetadata(RETURNS_METADATA, classRef.prototype, methodName);
    const pathMeta = methodMeta?.path;

    LOGGER.log(`Mapped {${baseUrl}${pathMeta}, ${methodMeta.method.toUpperCase()}} (returns ${returnTypeMeta?.dto?.name || 'void'})`)
  }

  async function doRequest(
    axiosConfig: any,
    returnTypeMetadata: ReturnMetadata | undefined = undefined,
    retry = true,
  ): Promise<any> {
    axiosConfig = await populateAxiosConfig({
      axiosConfig,
      config,
      auth,
      classRef,
    });
    try {
      LOGGER.debug(`Executing REST request: ${axiosConfig.method.toUpperCase()} ${axiosConfig.url}`);
      LOGGER.debug("Axios Config:", axiosConfig);
      const response: AxiosResponse = await axios(axiosConfig);
      const data = typeof response.data === 'string'
        ? JSON.parse(response.data)
        : response.data;
      if (returnTypeMetadata) {
        return plainToInstance(returnTypeMetadata.dto, data, returnTypeMetadata.classTransformOptions);
      }
      return data;
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
    get(_, prop: string | symbol) {
      if (typeof prop !== 'string') return undefined;

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

      if (!methodMeta) return undefined;

      return async (...args: any[]) => {
        const pathVariables: Record<string, any> = {};
        const placeholders = extractPathPlaceholders(methodMeta.path);

        // Endpoint déclaré sans corps (`getUser!: Endpoint<[id: string], User>`) :
        // aucun décorateur de paramètre n'est possible, les arguments sont donc
        // associés aux variables de chemin dans leur ordre d'apparition, le
        // suivant servant de payload.
        const positional =
          pathParamMeta.length === 0 &&
          queryParamMeta.length === 0 &&
          payloadIndex === undefined;

        if (positional) {
          placeholders.forEach((name, index) => {
            if (args[index] === undefined) {
              throw new Error(`Missing path variable: ${name}`);
            }
            pathVariables[name] = args[index];
          });
        } else {
          for (const { name, index } of pathParamMeta) {
            if (args[index] === undefined) {
              throw new Error(`Missing path variable: ${name}`);
            }
            pathVariables[name] = args[index];
          }
        }

        const payload = positional
          ? args[placeholders.length]
          : payloadIndex !== undefined
            ? args[payloadIndex]
            : undefined;
        const url = baseUrl + replacePathVariables(methodMeta.path, pathVariables);

        const axiosConfig: AxiosRequestConfig = {
          method: methodMeta.method,
          url
        }

        for (const { name, index } of queryParamMeta) {
          if (args[index] === undefined) continue;
          axiosConfig.params = {
            ...(axiosConfig.params || {}),
            [name]: args[index],
          };
        }

        if (methodMeta.method.toUpperCase() === 'GET') {
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
