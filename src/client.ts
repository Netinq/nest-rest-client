import 'reflect-metadata';
import {RestAuth} from './interfaces/auth.interface';
import {REST_CLIENT_METADATA, REST_CLIENT_METHOD_CONTENT_TYPE, ReturnMetadata, RETURNS_METADATA} from './decorators/rest';
import {Logger, Type} from '@nestjs/common';
import axios, {AxiosRequestConfig, AxiosResponse} from 'axios';
import {plainToInstance} from 'class-transformer';
import {AsyncLocalStorage} from 'node:async_hooks';
import {METHOD_METADATA, MethodMetadata} from './decorators/methods';
import {PATH_PARAM_METADATA, PAYLOAD_METADATA, QUERY_PARAM_METADATA} from './decorators/requestContext';
import type {RestClientConfig, RestClientResiliencePolicy} from './client.module';
import {extractPathPlaceholders, extractRequestConfig, getAllRestMethods, populateAxiosConfig, replacePathVariables} from './utils/client.helpers';
import {createResilienceOptions, getResilienceSettings} from './decorators/resilience';
import type {RestClientFallbackContext} from './decorators/resilience';

export const LOGGER = new Logger('NestRestClient');

function getResponseStatus(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null || !('response' in error)) return undefined;
  const response = error.response;
  if (typeof response !== 'object' || response === null || !('status' in response)) return undefined;
  return typeof response.status === 'number' ? response.status : undefined;
}

export function createNestRestClient<T extends object>(
  classRef: Type<T>,
  config?: RestClientConfig,
  auth?: RestAuth,
): T {

  LOGGER.debug(`Creating nest client ${classRef.name}`);

  const meta = Reflect.getMetadata(REST_CLIENT_METADATA, classRef);

  if (!meta) {
    throw new Error('Could not initialize rest client, @RestClient() not found on class ' + classRef.name);
  }

  const baseUrl = typeof meta.url === 'function' ? meta.url() : meta.url;
  const resiliencePolicyCache = new Map<string, RestClientResiliencePolicy>();
  const fallbackContextStorage = new AsyncLocalStorage<Omit<RestClientFallbackContext, 'signal' | 'attempt'>>();

  LOGGER.log(`Creating REST client for ${classRef.name} (${baseUrl})`);
  const methodNames = getAllRestMethods(classRef);

  for (const methodName of methodNames) {
    const methodMeta = Reflect.getMetadata(METHOD_METADATA, classRef.prototype, methodName);
    const returnTypeMeta = Reflect.getMetadata(RETURNS_METADATA, classRef.prototype, methodName);
    const pathMeta = methodMeta?.path;

    LOGGER.log(`Mapped {${baseUrl}${pathMeta}, ${methodMeta.method.toUpperCase()}} (returns ${returnTypeMeta?.dto?.name || 'void'})`)
  }

  async function doRequest(
    axiosConfig: AxiosRequestConfig,
    returnTypeMetadata: ReturnMetadata | undefined = undefined,
    requestContentType?: string,
    methodContentType?: string,
    resiliencePolicy?: RestClientResiliencePolicy,
    requestSignal?: AbortSignal,
    source?: string,
    resilienceArgs: readonly unknown[] = [],
    methodName = '',
    httpMethod = 'GET',
    path = '',
  ): Promise<any> {
    const executeRequest = async (signal?: AbortSignal): Promise<any> => {
      let populatedConfig = await populateAxiosConfig({
        axiosConfig,
        config,
        auth,
        classRef,
        requestContentType,
        methodContentType,
      });
      if (signal) populatedConfig = {...populatedConfig, signal};

      LOGGER.debug(`Executing REST request: ${populatedConfig.method?.toUpperCase()} ${populatedConfig.url}`);

      let response: AxiosResponse;
      try {
        response = await axios(populatedConfig);
      } catch (error) {
        if (getResponseStatus(error) !== 401 || !auth?.refreshToken) {
          const message = error instanceof Error ? error.message : String(error);
          LOGGER.error(`Error during REST request: ${message}`);
          throw error;
        }

        LOGGER.warn('Unauthorized request, attempting to refresh token');
        await auth.refreshToken();
        populatedConfig = await populateAxiosConfig({
          axiosConfig,
          config,
          auth,
          classRef,
          requestContentType,
          methodContentType,
        });
        if (signal) populatedConfig = {...populatedConfig, signal};
        response = await axios(populatedConfig);
      }

      const rawData = response.data;
      const isJsonResponse = typeof rawData === 'string' && (
        (typeof response.headers?.['content-type'] === 'string' && response.headers['content-type'].toLowerCase().includes('application/json')) ||
        ['{', '['].includes(rawData.trim().charAt(0))
      );
      const data = typeof rawData === 'string' && isJsonResponse
        ? (() => {
          try {
            return JSON.parse(rawData);
          } catch {
            return rawData;
          }
        })()
        : rawData;

      if (returnTypeMetadata) {
        return plainToInstance(returnTypeMetadata.dto, data, returnTypeMetadata.classTransformOptions);
      }
      return data;
    };

    const decoratorSettings = getResilienceSettings(classRef, methodName);
    if (decoratorSettings) {
      if (!config?.resilienceService) {
        throw new Error(`Resilience decorators on ${classRef.name}.${methodName} require RestClientModule.forRootAsync({ resilience: { service: ResilienceService } }).`);
      }
      resiliencePolicy = resiliencePolicyCache.get(methodName);
      if (!resiliencePolicy) {
        const options = createResilienceOptions(
          decoratorSettings,
          methodName,
          httpMethod,
          path,
          classRef.name,
          clientProxy,
          (attempt) => {
            const context = fallbackContextStorage.getStore();
            if (!context) {
              throw new Error(`Fallback for ${classRef.name}.${methodName} ran outside its REST request context.`);
            }
            return {...context, signal: attempt.signal, attempt: attempt.attempt};
          },
          config.resilienceModuleOptions,
        );
        resiliencePolicy = config.resilienceService.create(options, source);
        resiliencePolicyCache.set(methodName, resiliencePolicy);
      }
    }

    if (resiliencePolicy) {
      const execute = () => resiliencePolicy!.execute(({signal}) => executeRequest(signal), {
        source,
        signal: requestSignal,
      });
      return decoratorSettings
        ? fallbackContextStorage.run({
          clientName: classRef.name,
          methodName,
          httpMethod,
          path,
          args: resilienceArgs,
        }, execute)
        : execute();
    }

    return executeRequest(requestSignal);
  }

  const methodMetadataCache = new Map<
    string,
    {
      methodMeta: MethodMetadata;
      returnTypeMetadata?: ReturnMetadata;
      methodContentType?: string;
      pathParamMeta: Array<{ name: string; index: number }>;
      queryParamMeta: Array<{ name: string; index: number }>;
      payloadIndex?: number;
    }
  >();

  let clientProxy: T;
  clientProxy = new Proxy({} as T, {
    get(_, prop: string | symbol) {
      if (typeof prop !== 'string') return undefined;

      if (!methodMetadataCache.has(prop)) {
        const methodMeta: MethodMetadata = Reflect.getMetadata(
          METHOD_METADATA,
          classRef.prototype,
          prop,
        );
        if (!methodMeta) {
          const implementation = classRef.prototype[prop];
          return typeof implementation === 'function' ? implementation.bind(clientProxy) : undefined;
        }

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
        const methodContentType: string | undefined = Reflect.getMetadata(
          REST_CLIENT_METHOD_CONTENT_TYPE,
          classRef.prototype,
          prop,
        );
        methodMetadataCache.set(prop, {
          methodMeta,
          returnTypeMetadata,
          methodContentType,
          pathParamMeta,
          queryParamMeta,
          payloadIndex,
        });
      }

      const {
        methodMeta,
        returnTypeMetadata,
        methodContentType,
        pathParamMeta,
        queryParamMeta,
        payloadIndex,
      } = methodMetadataCache.get(prop)!;

      if (!methodMeta) return undefined;

      return async (...args: any[]) => {
        const requestConfig = extractRequestConfig(args);
        const methodArgs = requestConfig ? args.slice(0, -1) : args;
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
          placeholders.forEach((name: string, index: number) => {
            if (methodArgs[index] === undefined) {
              throw new Error(`Missing path variable: ${name}`);
            }
            pathVariables[name] = methodArgs[index];
          });
        } else {
          for (const { name, index } of pathParamMeta) {
            if (methodArgs[index] === undefined) {
              throw new Error(`Missing path variable: ${name}`);
            }
            pathVariables[name] = methodArgs[index];
          }
        }

        const payload = positional
          ? methodArgs[placeholders.length]
          : payloadIndex !== undefined
            ? methodArgs[payloadIndex]
            : undefined;
        const url = baseUrl + replacePathVariables(methodMeta.path, pathVariables);

        const axiosConfig: AxiosRequestConfig = {
          method: methodMeta.method,
          url,
          signal: requestConfig?.signal,
        };

        for (const { name, index } of queryParamMeta) {
          if (methodArgs[index] === undefined) continue;
          axiosConfig.params = {
            ...(axiosConfig.params || {}),
            [name]: methodArgs[index],
          };
        }

        if (requestConfig?.params) {
          axiosConfig.params = {
            ...(axiosConfig.params || {}),
            ...requestConfig.params,
          };
        }

        if (requestConfig?.headers) {
          axiosConfig.headers = {
            ...(axiosConfig.headers || {}),
            ...requestConfig.headers,
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

        const resiliencePolicy = typeof config?.resilience === 'function'
          ? config.resilience({
            clientName: classRef.name,
            methodName: prop,
            httpMethod: methodMeta.method,
            path: methodMeta.path,
          })
          : config?.resilience;

        return doRequest(
          axiosConfig,
          returnTypeMetadata,
          requestConfig?.contentType,
          methodContentType,
          resiliencePolicy,
          requestConfig?.signal,
          `${classRef.name}.${prop}`,
          methodArgs,
          prop,
          methodMeta.method,
          methodMeta.path,
        );
      }
    }
  });

  return clientProxy;

}
