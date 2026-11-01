import axios from 'axios';
import { createNestRestClient } from '../../src/client';
import { Get, Post } from '../../src/decorators/methods';
import { RestClient, ContentType } from '../../src/decorators/rest';
import ContentTypes from '../../src/constants/ContentTypes';
import { Endpoint } from '../../src/types/endpoint';
import type { RestClientResiliencePolicy } from '../../src/client.module';
import {
  Bulkhead,
  CircuitBreaker,
  Fallback,
  OutboundRateLimit,
  Resilience,
  Retry,
  Timeout,
} from '../../src/decorators/resilience';
import type {
  ResiliencePresetOptions,
  RestClientFallbackContext,
  RestClientResilienceService,
} from '../../src/decorators/resilience';

jest.mock('axios');
const axiosMock = axios as unknown as jest.MockedFunction<typeof axios>;

interface User {
  id: number;
  name: string;
}

@RestClient({ url: 'https://api.example.com' })
@ContentType(ContentTypes.JSON)
class ApiRestClient {
  @Get('/v1/foo')
  getFoo!: Endpoint<[], User[]>;

  @Get('/v1/users/:id')
  getUser!: Endpoint<[id: number], User>;

  @Post('/v1/users')
  createUser!: Endpoint<[body: { name: string }], User>;

  @Post('/v1/raw')
  @ContentType(ContentTypes.TEXT_PLAIN)
  createRaw!: Endpoint<[body: string], string>;
}

@RestClient({ url: 'https://api.example.com' })
@Resilience('carrier')
class ResilientApiClient {
  @Get('/v1/foo/:id')
  @Retry({attempts: 3})
  @Timeout('1.5s')
  @Fallback('flatRateQuotes')
  getFoo!: Endpoint<[id: number], User[]>;

  @Post('/v1/users')
  @Retry({attempts: 3})
  createUser!: Endpoint<[body: {name: string}], User>;

  flatRateQuotes(_error: unknown, context: RestClientFallbackContext): number {
    return context.args[0] as number;
  }
}

@RestClient({url: 'https://api.example.com'})
@Retry({attempts: 4})
@Timeout('2s')
@CircuitBreaker({name: 'direct-client-breaker', minimumCalls: 5})
@Bulkhead({name: 'direct-client-bulkhead', maxConcurrent: 8})
@OutboundRateLimit({name: 'direct-client-limit', limit: 50, interval: '1s'})
@Fallback('defaultResponse')
class DirectResilientApiClient {
  @Get('/v1/status')
  @Timeout('750ms')
  getStatus!: Endpoint<[], string>;

  defaultResponse(): string {
    return 'unavailable';
  }
}

describe('endpoints déclarés sans corps de méthode', () => {
  beforeEach(() => jest.clearAllMocks());

  it('appelle l’URL sans variable de chemin', async () => {
    axiosMock.mockResolvedValueOnce({ data: [{ id: 1, name: 'a' }] } as any);

    const client = createNestRestClient(ApiRestClient);
    const result = await client.getFoo();

    expect(axiosMock).toHaveBeenCalledWith(
      expect.objectContaining({
        url: 'https://api.example.com/v1/foo',
        method: 'GET',
        headers: expect.objectContaining({ 'Content-Type': 'application/json' }),
      }),
    );
    expect(result).toEqual([{ id: 1, name: 'a' }]);
  });

  it('associe les arguments aux variables de chemin par position', async () => {
    axiosMock.mockResolvedValueOnce({ data: { id: 42, name: 'b' } } as any);

    const client = createNestRestClient(ApiRestClient);
    await client.getUser(42);

    expect(axiosMock).toHaveBeenCalledWith(
      expect.objectContaining({ url: 'https://api.example.com/v1/users/42' }),
    );
  });

  it('utilise l’argument suivant comme payload', async () => {
    axiosMock.mockResolvedValueOnce({ data: { id: 1, name: 'c' } } as any);

    const client = createNestRestClient(ApiRestClient);
    await client.createUser({ name: 'c' });

    expect(axiosMock).toHaveBeenCalledWith(
      expect.objectContaining({
        url: 'https://api.example.com/v1/users',
        method: 'POST',
        data: { name: 'c' },
      }),
    );
  });

  it('applique le content-type défini sur la requête', async () => {
    axiosMock.mockResolvedValueOnce({ data: 'ok' } as any);

    const client = createNestRestClient(ApiRestClient);
    await client.createRaw('hello');

    expect(axiosMock).toHaveBeenCalledWith(
      expect.objectContaining({
        url: 'https://api.example.com/v1/raw',
        method: 'POST',
        headers: expect.objectContaining({ 'Content-Type': 'text/plain' }),
        data: 'hello',
      }),
    );
  });

  it('priorise le content-type fourni dans la config de requête', async () => {
    axiosMock.mockResolvedValueOnce({ data: { id: 1, name: 'd' } } as any);

    const client = createNestRestClient(ApiRestClient);
    await client.createUser({ name: 'd' }, { contentType: ContentTypes.TEXT_PLAIN });

    expect(axiosMock).toHaveBeenCalledWith(
      expect.objectContaining({
        headers: expect.objectContaining({ 'Content-Type': 'text/plain' }),
      }),
    );
  });

  it('exécute les requêtes à travers la policy choisie et transmet les signaux', async () => {
    const callerController = new AbortController();
    const attemptController = new AbortController();
    const execute = jest.fn(async (
      run: (context: {signal: AbortSignal; attempt: number}) => Promise<unknown>,
    ) => run({signal: attemptController.signal, attempt: 1}));
    const resilience = {execute} as unknown as RestClientResiliencePolicy;
    const selectPolicy = jest.fn(({httpMethod}: {httpMethod: string}) =>
      httpMethod === 'GET' ? resilience : undefined,
    );
    axiosMock.mockResolvedValueOnce({data: [{id: 1, name: 'a'}]} as any);

    const client = createNestRestClient(ApiRestClient, {resilience: selectPolicy});
    await client.getFoo({signal: callerController.signal});

    expect(selectPolicy).toHaveBeenCalledWith({
      clientName: 'ApiRestClient',
      methodName: 'getFoo',
      httpMethod: 'GET',
      path: '/v1/foo',
    });
    expect(execute).toHaveBeenCalledWith(expect.any(Function), {
      source: 'ApiRestClient.getFoo',
      signal: callerController.signal,
    });
    expect(axiosMock).toHaveBeenCalledWith(expect.objectContaining({signal: attemptController.signal}));
  });

  it('permet de ne pas activer les retries pour les écritures non idempotentes', async () => {
    const execute = jest.fn();
    const resilience = {execute} as unknown as RestClientResiliencePolicy;
    const client = createNestRestClient(ApiRestClient, {
      resilience: ({httpMethod}) => httpMethod === 'GET' ? resilience : undefined,
    });
    axiosMock.mockResolvedValueOnce({data: {id: 1, name: 'write'}} as any);

    await client.createUser({name: 'write'});

    expect(execute).not.toHaveBeenCalled();
    expect(axiosMock).toHaveBeenCalledTimes(1);
  });

  it('compose les décorateurs avec le preset et désactive les retries non idempotents', async () => {
    const options: ResiliencePresetOptions = {
      timeout: '5s',
      circuitBreaker: {failureRateThreshold: 40},
    };
    const policies: ResiliencePresetOptions[] = [];
    const service: RestClientResilienceService = {
      preset: jest.fn(),
      create: jest.fn((policyOptions) => {
        policies.push(policyOptions);
        return {
          execute: async (operation: (context: {readonly signal: AbortSignal; readonly attempt: number}) => unknown | PromiseLike<unknown>) => {
            const attempt = {signal: new AbortController().signal, attempt: 1};
            try {
              return await operation(attempt);
            } catch (error) {
              const fallback = policyOptions.fallback as {
                handler: (failure: unknown, context: typeof attempt) => unknown;
              };
              return fallback.handler(error, attempt);
            }
          },
        } as unknown as RestClientResiliencePolicy;
      }),
    };
    axiosMock
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({data: {id: 1, name: 'resilient'}} as any);

    const client = createNestRestClient(ResilientApiClient, {
      resilienceService: service,
      resilienceModuleOptions: {presets: {carrier: options}},
    });
    await expect(client.getFoo(42)).resolves.toBe(42);
    await client.createUser({name: 'write'});

    expect(policies[0]).toMatchObject({
      timeout: '1.5s',
      retry: {attempts: 3},
      circuitBreaker: {failureRateThreshold: 40, name: 'carrier'},
    });
    expect(policies[1]).toMatchObject({
      timeout: '5s',
      retry: false,
      circuitBreaker: {failureRateThreshold: 40, name: 'carrier'},
    });
    expect(service.create).toHaveBeenCalledTimes(2);
  });

  it('applique les décorateurs au client entier avec surcharge possible par endpoint', async () => {
    const create = jest.fn((options: ResiliencePresetOptions) => ({
      execute: async <T>(operation: (context: {signal: AbortSignal; attempt: number}) => T | PromiseLike<T>) =>
        operation({signal: new AbortController().signal, attempt: 1}),
    }));
    const service = {create} as unknown as RestClientResilienceService;
    axiosMock.mockResolvedValue({data: 'ok'} as any);

    const client = createNestRestClient(DirectResilientApiClient, {resilienceService: service});
    await client.getStatus();

    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0][0]).toMatchObject({
      retry: {attempts: 4},
      timeout: '750ms',
      circuitBreaker: {name: 'direct-client-breaker', minimumCalls: 5},
      bulkhead: {name: 'direct-client-bulkhead', maxConcurrent: 8},
      outboundRateLimit: {name: 'direct-client-limit', limit: 50, interval: '1s'},
      fallback: {handler: expect.any(Function)},
    });
  });
});
