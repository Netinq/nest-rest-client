import {RestClientAsyncOptions, RestClientOptions} from '../client.module';
import {RestAuthProvider} from '../interfaces/auth.interface';
import {createNestRestClient} from '../client';

export function getAuthProviderToken(authProvider?: RestAuthProvider): any | undefined {
  if (!authProvider) return undefined;
  if (typeof authProvider === 'function') {
    return authProvider;
  }
  if ('provide' in authProvider) {
    return authProvider.provide;
  }
  return undefined;
}

export class RestClientFactory {
  static async createProvider(
    options: RestClientAsyncOptions,
    ...args: any[]
  ): Promise<Record<string, any>> {
    const opts: RestClientOptions[] = args[0];
    const globalAuth = getAuthProviderToken(options.globalAuthProvider) ? args[1] : undefined;
    const startIndex = globalAuth ? 2 : 1;
    const injectedAuthProviders = args.slice(startIndex);

    const clients: Record<string, any> = {};

    for (const opt of opts) {
      const authInstance = opt.authProvider
        ? injectedAuthProviders.find(inst => inst && (inst.constructor === opt.authProvider || inst === opt.authProvider))
        : globalAuth;

      clients[opt.client.name] = createNestRestClient(opt.client, opt.config, authInstance);
    }

    return clients;
  }
}
