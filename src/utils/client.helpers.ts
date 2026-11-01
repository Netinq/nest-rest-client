import { AxiosRequestConfig } from 'axios';
import ContentTypes from '../constants/ContentTypes';
import type { RestClientConfig, RestRequestConfig } from '../client.module';
import { RestAuth } from '../interfaces/auth.interface';
import { REST_CLIENT_CONTENT_TYPE, REST_CLIENT_METADATA } from '../decorators/rest';
import { ENDPOINTS_METADATA } from '../decorators/methods';

export function replacePathVariables(path: string, variables: Record<string, any>) {
  return path.replace(/:([a-zA-Z0-9_]+)/g, (_, key) => {
    if (variables[key] === undefined) {
      throw new Error(`Missing path variable: ${key}`);
    }
    return encodeURIComponent(String(variables[key]));
  });
}

export function getAllRestMethods(classRef: any): string[] {
  const endpoints: (string | symbol)[] =
    Reflect.getMetadata(ENDPOINTS_METADATA, classRef.prototype) ?? [];
  return endpoints.filter((key): key is string => typeof key === 'string');
}

export function extractPathPlaceholders(path: string): string[] {
  return (path.match(/:([a-zA-Z0-9_]+)/g) || []).map((match) => match.slice(1));
}

export function extractRequestConfig(args: any[]): RestRequestConfig | undefined {
  if (args.length === 0) return undefined;

  const lastArg = args[args.length - 1];
  if (!lastArg || typeof lastArg !== 'object' || Array.isArray(lastArg)) {
    return undefined;
  }

  const hasRequestConfig = 'headers' in lastArg || 'params' in lastArg || 'contentType' in lastArg || 'signal' in lastArg;
  if (!hasRequestConfig) return undefined;

  return {
    headers: lastArg.headers,
    params: lastArg.params,
    contentType: lastArg.contentType,
    signal: lastArg.signal,
  };
}

export async function populateAxiosConfig({
                                            axiosConfig,
                                            config,
                                            auth,
                                            classRef,
                                            requestContentType,
                                            methodContentType,
                                          }: {
  axiosConfig: AxiosRequestConfig;
  config?: RestClientConfig;
  auth?: RestAuth;
  classRef: new (...args: any[]) => any;
  requestContentType?: string;
  methodContentType?: string;
}): Promise<AxiosRequestConfig> {
  const classHeaders = Reflect.getMetadata(REST_CLIENT_METADATA, classRef)?.headers || {};
  const classContentType = Reflect.getMetadata(REST_CLIENT_METADATA, classRef)?.contentType || Reflect.getMetadata(REST_CLIENT_CONTENT_TYPE, classRef);
  const headers = {
    ...(classHeaders || {}),
    ...(config?.headers || {}),
    ...(axiosConfig.headers || {}),
  };

  if (auth) {
    const token = await auth.getToken();
    if (!token) {
      throw new Error('No token provided by auth service');
    }
    headers['Authorization'] = `Bearer ${token}`;
  }

  const effectiveRequestContentType = requestContentType || headers['Content-Type'] || headers['content-type'];
  const preferredContentType = effectiveRequestContentType || methodContentType || classContentType || ContentTypes.JSON;

  if (effectiveRequestContentType) {
    headers['Content-Type'] = effectiveRequestContentType;
  } else if (!headers['Content-Type'] && !headers['content-type']) {
    headers['Content-Type'] = preferredContentType;
  }

  if (!headers['Accept'] && !headers['accept']) {
    headers['Accept'] = preferredContentType;
  }

  return {
    ...axiosConfig,
    headers,
  };
}
