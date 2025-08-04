import {DynamicModule, Module, Provider, Type} from '@nestjs/common';
import {createNestRestClient} from './client';

export interface RestClientOptions<T = any> {
  client: Type<T>;
  deps?: Provider[];
  inject?: any[];
  config?: Record<string, any>;
  useAuthFactory?: (...args: any[]) => Promise<string> | string;
}

@Module({})
export class RestClientModule {
  static forRoot<T extends object>(options: RestClientOptions<T>): DynamicModule {

    const providers: Provider[] = [];

    const AUTH_TOKEN = 'REST_CLIENT_AUTH_TOKEN';

    if (options.useAuthFactory) {
      const authProvider: Provider = {
          provide: AUTH_TOKEN,
          useFactory: options.useAuthFactory,
          inject: options.inject || [],
        };
      providers.push(authProvider);
    }

    const clientProvider: Provider = {
      provide: options.client,
      useFactory: (...injectedDeps: any[]) => {
        return createNestRestClient(options.client, ...injectedDeps);
      },
      inject: options.inject || [],
    };

    providers.push(clientProvider);

    const configProviders: Provider[] = Object.entries(options.config || {}).map(
      ([key, value]) => ({
        provide: key,
        useValue: value,
      }),
    );

    return {
      module: RestClientModule,
      providers: [...(options.deps || []), ...configProviders, ...providers],
      exports: [options.client],
    };
  }
}
