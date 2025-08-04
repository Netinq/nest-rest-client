import {DynamicModule, Module, Provider, Type} from '@nestjs/common';
import {createNestRestClient} from './client';

export interface RestClientOptions<T = any> {
  client: Type<T>;
  deps?: Provider[];
  inject?: any[];
  config?: Record<string, any>;
}

@Module({})
export class RestClientModule {
  static forRoot<T extends object>(options: RestClientOptions<T>): DynamicModule {

    const clientProvider: Provider = {
      provide: options.client,
      useFactory: (...injectedDeps: any[]) => {
        return createNestRestClient(options.client, ...injectedDeps);
      },
      inject: options.inject || [],
    };

    const configProviders: Provider[] = Object.entries(options.config || {}).map(
      ([key, value]) => ({
        provide: key,
        useValue: value,
      }),
    );

    return {
      module: RestClientModule,
      providers: [...(options.deps || []), ...configProviders, clientProvider],
      exports: [options.client],
    };
  }
}
