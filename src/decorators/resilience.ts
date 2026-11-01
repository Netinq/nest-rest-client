import 'reflect-metadata';

export type ResilienceDuration = number | string;

export interface RetryOptions {
  attempts?: number;
  backoff?: BackoffOptions | ((attempt: number, error: unknown) => ResilienceDuration);
  retryIf?: (error: unknown, attempt: number) => boolean;
  retryOnResult?: (result: unknown, attempt: number) => boolean;
  idempotent?: boolean;
}

export interface BackoffOptions {
  delay?: ResilienceDuration;
  factor?: number;
  maxDelay?: ResilienceDuration;
  jitter?: 'full' | 'equal' | 'none';
}

export interface CircuitBreakerOptions {
  name?: string;
  failureRateThreshold?: number;
  minimumCalls?: number;
  slidingWindow?: {type: 'count'; size: number} | {type: 'time'; size: ResilienceDuration};
  openDuration?: ResilienceDuration;
  halfOpenMaxCalls?: number;
  recordIf?: (error: unknown) => boolean;
}

export interface BulkheadOptions {
  name?: string;
  maxConcurrent?: number;
  maxQueue?: number;
  queueTimeout?: ResilienceDuration;
}

export interface OutboundRateLimitOptions {
  name?: string;
  limit: number;
  interval: ResilienceDuration;
  maxWait?: ResilienceDuration;
}

export interface RestClientFallbackContext {
  readonly clientName: string;
  readonly methodName: string;
  readonly httpMethod: string;
  readonly path: string;
  readonly args: readonly unknown[];
  readonly signal: AbortSignal;
  readonly attempt: number;
}

export type RestClientFallbackHandler = (
  error: unknown,
  context: RestClientFallbackContext,
) => unknown | PromiseLike<unknown>;

export interface FallbackOptions {
  handleIf?: (error: unknown) => boolean;
}

export interface ResiliencePresetOptions {
  retry?: number | false | RetryOptions;
  timeout?: ResilienceDuration;
  circuitBreaker?: CircuitBreakerOptions | string;
  bulkhead?: BulkheadOptions | string;
  outboundRateLimit?: OutboundRateLimitOptions | string;
  fallback?: RestClientFallbackHandler | {
    handler: RestClientFallbackHandler;
    handleIf?: (error: unknown) => boolean;
  };
}

export interface RestClientResilienceService {
  preset(name: string): RestResiliencePolicy;
  create(options: ResiliencePresetOptions, name?: string): RestResiliencePolicy;
}

export interface RestResiliencePolicy {
  execute<T>(
    operation: (context: {readonly signal: AbortSignal; readonly attempt: number}) => T | PromiseLike<T>,
    options?: {signal?: AbortSignal; source?: string},
  ): Promise<T>;
}

export interface RestClientResilienceModuleOptions {
  defaults?: {
    retry?: number | RetryOptions;
    timeout?: ResilienceDuration;
    circuitBreaker?: Omit<CircuitBreakerOptions, 'name'>;
    bulkhead?: Omit<BulkheadOptions, 'name'>;
  };
  presets?: Record<string, ResiliencePresetOptions>;
  mapErrors?: boolean;
  isGlobal?: boolean;
}

export interface RestClientResilienceSettings {
  service: RestClientResilienceService;
  moduleOptions?: RestClientResilienceModuleOptions;
}

const RESILIENCE_METADATA = 'REST_CLIENT:RESILIENCE';
const STAGES = ['retry', 'timeout', 'circuitBreaker', 'bulkhead', 'outboundRateLimit', 'fallback'] as const;
type Stage = typeof STAGES[number];
type StageSettings = Partial<Record<Stage, unknown>>;
interface DecoratorSettings {
  preset?: string;
  stages: StageSettings;
}

type ResilienceDecorator = ClassDecorator & MethodDecorator & PropertyDecorator;

function setSettings(target: object, propertyKey: string | symbol | undefined, update: (settings: DecoratorSettings) => void): void {
  const metadataTarget = target;
  const existing: DecoratorSettings = propertyKey === undefined
    ? Reflect.getOwnMetadata(RESILIENCE_METADATA, metadataTarget) ?? {stages: {}}
    : Reflect.getOwnMetadata(RESILIENCE_METADATA, metadataTarget, propertyKey) ?? {stages: {}};
  const settings = {preset: existing.preset, stages: {...existing.stages}};
  update(settings);
  if (propertyKey === undefined) {
    Reflect.defineMetadata(RESILIENCE_METADATA, settings, metadataTarget);
  } else {
    Reflect.defineMetadata(RESILIENCE_METADATA, settings, metadataTarget, propertyKey);
  }
}

function decorator(update: (settings: DecoratorSettings) => void): ResilienceDecorator {
  return ((target: object, propertyKey?: string | symbol) => {
    setSettings(target, propertyKey, update);
  }) as ResilienceDecorator;
}

export function Resilience(preset: string): ResilienceDecorator {
  return decorator((settings) => { settings.preset = preset; });
}

export function Retry(options: number | false | RetryOptions = {}): ResilienceDecorator {
  return decorator((settings) => { settings.stages.retry = options; });
}

export function Timeout(timeout?: ResilienceDuration): ResilienceDecorator {
  return decorator((settings) => { settings.stages.timeout = {enabled: true, value: timeout}; });
}

export function CircuitBreaker(options: CircuitBreakerOptions | string = {}): ResilienceDecorator {
  return decorator((settings) => { settings.stages.circuitBreaker = options; });
}

export function Bulkhead(options: BulkheadOptions | string = {}): ResilienceDecorator {
  return decorator((settings) => { settings.stages.bulkhead = options; });
}

export function OutboundRateLimit(options: OutboundRateLimitOptions | string): ResilienceDecorator {
  return decorator((settings) => { settings.stages.outboundRateLimit = options; });
}

export function Fallback(
  handler: string | RestClientFallbackHandler,
  options: FallbackOptions = {},
): ResilienceDecorator {
  return decorator((settings) => {
    settings.stages.fallback = typeof handler === 'string'
      ? {method: handler, handleIf: options.handleIf}
      : {handler, handleIf: options.handleIf};
  });
}

export function getResilienceSettings(
  classRef: Function,
  methodName: string,
): DecoratorSettings | undefined {
  const classSettings: DecoratorSettings | undefined = Reflect.getOwnMetadata(RESILIENCE_METADATA, classRef);
  const methodSettings: DecoratorSettings | undefined = Reflect.getOwnMetadata(
    RESILIENCE_METADATA,
    classRef.prototype,
    methodName,
  );
  if (!classSettings && !methodSettings) return undefined;

  const stages = {...classSettings?.stages};
  for (const stage of STAGES) {
    const override = methodSettings?.stages[stage];
    if (override === undefined) continue;

    const base = stages[stage];
    if (
      base && override &&
      typeof base === 'object' && !Array.isArray(base) &&
      typeof override === 'object' && !Array.isArray(override)
    ) {
      const definedOverrides = Object.fromEntries(
        Object.entries(override).filter(([, value]) => value !== undefined),
      );
      if (stage === 'fallback' && ('handler' in definedOverrides || 'method' in definedOverrides)) {
        const baseFallback = base as Record<string, unknown>;
        stages[stage] = {
          ...('handleIf' in definedOverrides ? {} : {handleIf: baseFallback.handleIf}),
          ...definedOverrides,
        };
      } else {
        stages[stage] = {...base, ...definedOverrides};
      }
    } else {
      stages[stage] = override;
    }
  }
  return {
    preset: methodSettings?.preset ?? classSettings?.preset,
    stages,
  };
}

export function createResilienceOptions(
  settings: DecoratorSettings,
  methodName: string,
  httpMethod: string,
  path: string,
  className: string,
  client: object,
  fallbackContext: (attempt: {signal: AbortSignal; attempt: number}) => RestClientFallbackContext,
  moduleOptions: RestClientResilienceModuleOptions = {},
): ResiliencePresetOptions {
  const presetName = settings.preset;
  const preset = presetName ? moduleOptions.presets?.[presetName] : undefined;
  if (presetName && !preset) {
    const known = Object.keys(moduleOptions.presets ?? {});
    throw new Error(`Unknown resilience preset "${presetName}" for REST client. Known presets: ${known.length ? known.join(', ') : '(none)'}.`);
  }

  const options: ResiliencePresetOptions = {...preset};
  if (presetName) {
    for (const stage of ['circuitBreaker', 'bulkhead', 'outboundRateLimit'] as const) {
      const value = options[stage];
      if (value && typeof value === 'object' && !('name' in value)) {
        (options as Record<string, unknown>)[stage] = {...value, name: presetName};
      }
    }
  }

  for (const stage of STAGES) {
    if (!(stage in settings.stages)) continue;
    const value = settings.stages[stage];
    if (stage === 'timeout') {
      const configured = value as {enabled: boolean; value?: ResilienceDuration};
      options.timeout = configured.value ?? options.timeout ?? moduleOptions.defaults?.timeout;
      if (options.timeout === undefined) {
        throw new Error(`@Timeout() on ${className}.${methodName} needs a duration or a timeout in the preset/defaults.`);
      }
      continue;
    }
    if (stage === 'retry') {
      if (value === false || typeof value === 'number') {
        options.retry = value;
      } else {
        const base = typeof options.retry === 'object'
          ? options.retry
          : typeof options.retry === 'number'
            ? {attempts: options.retry}
            : {};
        const override = value as RetryOptions;
        options.retry = {
          ...base,
          ...override,
          ...(base.backoff && override.backoff && typeof base.backoff === 'object' && typeof override.backoff === 'object'
            ? {backoff: {...base.backoff, ...override.backoff}}
            : {}),
        };
      }
      continue;
    }
    if (stage === 'fallback') {
      const configured = value as {handler?: RestClientFallbackHandler; method?: string; handleIf?: (error: unknown) => boolean};
      const handler = (error: unknown, attempt: {signal: AbortSignal; attempt: number}) => {
        const context = fallbackContext(attempt);
        if (configured.handler) return configured.handler(error, context);

        const method = (client as Record<string, unknown>)[configured.method!];
        if (typeof method !== 'function') {
          throw new Error(`Fallback method "${configured.method}" is not a function on REST client ${className}.`);
        }
        return method.call(client, error, context);
      };
      options.fallback = {handler, handleIf: configured.handleIf};
      continue;
    }

    const current = options[stage];
    if (
      typeof current === 'string' &&
      value && typeof value === 'object' &&
      Object.keys(value).length === 0
    ) {
      continue;
    }
    if (typeof value === 'string' || typeof current === 'string') {
      options[stage] = value as never;
    } else {
      options[stage] = {...(current ?? {}), ...(value as object)} as never;
    }
  }

  const retry = options.retry;
  if (!['GET', 'HEAD', 'OPTIONS'].includes(httpMethod.toUpperCase())) {
    const isIdempotent = typeof retry === 'object' && retry.idempotent === true;
    if (!isIdempotent) options.retry = false;
  }
  if (typeof options.retry === 'object') {
    const {idempotent: _idempotent, ...policyRetry} = options.retry;
    options.retry = policyRetry;
  }
  return options;
}
