import {DynamicModule, Module, Provider, Type} from '@nestjs/common';
import {RestAuth, RestAuthProvider} from './interfaces/auth.interface';
import {getAuthProviderToken, RestClientFactory} from './factory/client.factory';
import type {MethodMetadata} from './decorators/methods';
import type {RestClientResilienceModuleOptions, RestClientResilienceService} from './decorators/resilience';

export interface RestClientOptions<T = any> {
  client: Type<T>;
  config?: RestClientConfig;
  authProvider?: Type<RestAuth>;
  useAuthFactory?: (...args: any[]) => Promise<RestAuth> | RestAuth;
  inject?: any[];
}

export interface RestClientConfig {
  headers?: Record<string, string>;
  providers?: Record<string, any>;
  resilience?: RestClientResiliencePolicy | ((context: RestClientResilienceContext) => RestClientResiliencePolicy | undefined);
  resilienceService?: RestClientResilienceService;
  resilienceModuleOptions?: RestClientResilienceModuleOptions;
}

export interface RestClientResiliencePolicy {
  execute<T>(
    operation: (context: RestClientResilienceAttempt) => T | PromiseLike<T>,
    options?: {signal?: AbortSignal; source?: string},
  ): Promise<T>;
}

export interface RestClientResilienceAttempt {
  readonly signal: AbortSignal;
  readonly attempt: number;
}

export interface RestRequestConfig {
  headers?: Record<string, string>;
  params?: Record<string, any>;
  contentType?: string;
  signal?: AbortSignal;
}

export interface RestClientResilienceContext {
  clientName: string;
  methodName: string;
  httpMethod: MethodMetadata['method'];
  path: string;
}

export interface RestClientAsyncOptions {
  imports?: any[];
  useFactory: (...args: any[]) => Promise<RestClientOptions[]> | RestClientOptions[];
  inject?: any[];
  resilience?: {
    service: any;
    options?: RestClientResilienceModuleOptions;
  };
  globalAuthProvider?: RestAuthProvider;
  authProviderInject?: Provider[];
}

@Module({})
export class RestClientModule {
  static forRoot(clients: RestClientOptions[] | RestClientOptions): DynamicModule {
    const normalizedClients = Array.isArray(clients) ? clients : [clients];

    return RestClientModule.forRootAsync({
      useFactory: () => normalizedClients,
    });
  }

  static forRootAsync(options: RestClientAsyncOptions): DynamicModule {
    const clientsProvider: Provider = {
      provide: 'REST_CLIENTS',
      useFactory: (...args: any[]) => RestClientFactory.createProvider(options, ...args),
      inject: [
        'REST_CLIENTS_OPTIONS',
        getAuthProviderToken(options.globalAuthProvider),
        ...(options.authProviderInject || [])
      ].filter(Boolean),
    };

    // Provider des options
    const asyncOptionsProvider: Provider = {
      provide: 'REST_CLIENTS_OPTIONS',
      useFactory: async (...args: any[]) => {
        const clients = await options.useFactory(...args.slice(0, (options.inject || []).length));
        if (!options.resilience) return clients;

        const resilienceService = args[(options.inject || []).length];
        const resilienceModuleOptions = options.resilience.options;
        return clients.map((client) => ({
          ...client,
          config: {
            ...client.config,
            resilienceService: client.config?.resilienceService ?? resilienceService,
            resilienceModuleOptions: client.config?.resilienceModuleOptions ?? resilienceModuleOptions,
          },
        }));
      },
      inject: [
        ...(options.inject || []),
        ...(options.resilience ? [options.resilience.service] : []),
      ],
    };

    const providers: Provider[] = [
      asyncOptionsProvider,
      clientsProvider,
      ...(options.globalAuthProvider ? [options.globalAuthProvider] : []),
      ...(options.authProviderInject || []),
    ];

    if (options.globalAuthProvider) {
      providers.push(options.globalAuthProvider);
    }

    return {
      module: RestClientModule,
      global: true,
      imports: options.imports || [],
      providers,
      exports: [clientsProvider, options.globalAuthProvider].filter(Boolean) as Provider[],
    };
  }

  static forFeature(clients: Type<any>[]): DynamicModule {
    const providers = clients.map(clientClass => ({
      provide: clientClass,
      useFactory: (allClients: Record<string, any>) => {
        return allClients[clientClass.name];
      },
      inject: ['REST_CLIENTS'],
    }));

    return {
      module: RestClientModule,
      providers,
      exports: providers.map(p => p.provide),
    };
  }
}
