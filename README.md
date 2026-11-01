# nest-rest-client

A NestJS utility to declare REST clients as typed classes and call them like proxied methods.

## Features

- Declarative REST clients with HTTP method decorators.
- Typed endpoint arguments and return values.
- NestJS dependency injection and configurable client registration.
- Dynamic configuration through Nest providers and async factories.
- Optional authentication providers, including token refresh.
- Client-, module-, and request-level headers and content types.
- Optional resilience policies through `@nestjs/resilience`.
- JSON, HTML, and plain-text response handling.

## Requirements

- Node.js `^20.19.0` or `>=22.12.0`.
- NestJS `@nestjs/common` and `@nestjs/core` `^11.1.5` or `^12.0.0`.
- Axios `^1.11.0`.
- `class-transformer` `^0.5.1`.
- `@nestjs/resilience` is optional and installed separately. Version `0.0.3` supports NestJS 12 only; on NestJS 11, use a release of `@nestjs/resilience` whose peer dependencies explicitly support NestJS 11, or omit the resilience integration.

## Installation

```bash
npm install @sarqdev/nest-rest-client
```

Install the optional resilience integration separately when needed:

```bash
npm install @nestjs/resilience
```

## Registration strategy

Use the registration method that matches your app.

### `forRoot(...)` for static configuration

Use this when your clients are known at startup and you do not need Nest dependency injection to compute them.

```ts
import { Module } from '@nestjs/common';
import { RestClientModule } from '@sarqdev/nest-rest-client';

@Module({
  imports: [
    RestClientModule.forRoot([
      { client: ApiRestClient },
      { client: UserClient },
    ]),
  ],
})
export class AppModule {}
```

### `forRootAsync(...)` for dynamic configuration

Use this when the list of clients or headers depends on environment variables, config services, or async factories.

```ts
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RestClientModule } from '@sarqdev/nest-rest-client';

@Module({
  imports: [
    RestClientModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => [
        {
          client: ApiRestClient,
          config: {
            headers: {
              'X-Api-Key': config.getOrThrow('API_KEY'),
            },
          },
        },
      ],
    }),
  ],
})
export class AppModule {}
```

### `forFeature(...)` for local module consumption

`forFeature` does not create the registry. It exposes a subset of clients that were already registered by a root module.

```ts
import { Module } from '@nestjs/common';
import { RestClientModule } from '@sarqdev/nest-rest-client';

@Module({
  imports: [
    RestClientModule.forRoot([
      { client: UserClient },
      { client: OrderClient },
    ]),
  ],
})
export class AppModule {}

@Module({
  imports: [RestClientModule.forFeature([UserClient])],
})
export class UserModule {}
```

This is the package's module organization pattern:
- one root module creates the clients
- each feature module imports only what it needs via `forFeature`

`forRoot()` and `forRootAsync()` register the root client registry as a global dynamic module. `forFeature()` provides and exports only the requested client tokens to a feature module; it does not create another registry.

## Quick start

```ts
import {
  RestClient,
  ContentType,
  ContentTypes,
  Get,
  Post,
  Endpoint,
} from '@sarqdev/nest-rest-client';

interface Foo {
  id: string;
  name: string;
}

interface CreateFooDto {
  name: string;
}

@RestClient({
  url: 'https://api.example.com',
  headers: {
    'X-App': 'demo',
  },
  contentType: ContentTypes.JSON,
})
@ContentType(ContentTypes.JSON)
export class ApiRestClient {
  @Get('/v1/foo')
  getFoo!: Endpoint<[], Foo[]>;

  @Get('/v1/foo/:id')
  getFooById!: Endpoint<[id: string], Foo>;

  @Post('/v1/foo')
  createFoo!: Endpoint<[body: CreateFooDto], Foo>;
}
```

## How arguments are bound

For declaration-only endpoints typed with `Endpoint<[...], Result>`, arguments are positional: path placeholders consume arguments in their order of appearance, and the next argument is the payload. A `GET` payload object is merged into query parameters; for other methods, it becomes the request body. When using `@PathParam`, `@QueryParam`, and `@Payload` on method parameters, those decorators bind the corresponding argument positions explicitly.

```ts
await client.getFooById('42');
await client.createFoo({ name: 'Alice' });
```

## Headers and content type

### Client-level defaults

```ts
@RestClient({
  url: 'https://api.example.com',
  headers: {
    'X-Client': 'portal',
  },
  contentType: ContentTypes.JSON,
})
export class ApiClient {
  @Get('/status')
  getStatus!: Endpoint<[], { ok: boolean }>;
}
```

### Module-level defaults

```ts
RestClientModule.forRootAsync({
  useFactory: () => [
    {
      client: ApiClient,
      config: {
        headers: {
          'X-Global': 'shared',
        },
      },
    },
  ],
});
```

### Request-level override

```ts
await client.getStatus({
  headers: {
    'X-Trace-Id': 'abc-123',
    'Content-Type': ContentTypes.TEXT_PLAIN,
  },
});
```

You can also override via the shortcut property:

```ts
await client.getStatus({
  contentType: ContentTypes.TEXT_PLAIN,
  headers: {
    'X-Trace-Id': 'abc-123',
  },
});
```

For a header with the same name and casing, request-level headers override module-level `config.headers`, which override client-level headers. The auth provider's token is assigned to `Authorization` after those merges and therefore takes precedence over a manually configured `Authorization` header. Content type selection is: request-level `contentType`; the merged uppercase `Content-Type` header (request over module over client); lowercase `content-type` if no uppercase value exists; endpoint `@ContentType`; client-level `contentType` or class `@ContentType`; then JSON. An explicit `Accept` header is preserved; otherwise `Accept` defaults to the selected content type.

## `@RestClient` and `@ContentType`

```ts
@RestClient({
  url: 'https://api.example.com',
  headers: {
    'X-App': 'demo',
  },
  contentType: ContentTypes.JSON,
})
@ContentType(ContentTypes.JSON)
export class ApiRestClient {}
```

- `@RestClient` defines the base URL and default config
- `@ContentType` sets the default content type for the client
- `@ContentType` can also decorate an endpoint method to override the client default for that request
- request config can override both at call time

```ts
@RestClient({ url: 'https://api.example.com' })
export class ApiRestClient {
  @Get('/v1/plain')
  @ContentType(ContentTypes.TEXT_PLAIN)
  getPlainText!: Endpoint<[], string>;
}
```

## Authentication

If an auth provider is configured, the library adds the authorization header automatically.

An auth provider implements `getToken(): Promise<string>`. The returned token is assigned to the `Authorization` header. If `refreshToken()` is also implemented, the client refreshes and retries the request once after a 401 response.

```ts
RestClientModule.forRootAsync({
  authProviderInject: [MyAuthProvider],
  useFactory: async () => [
    {
      client: ProtectedClient,
      authProvider: MyAuthProvider,
    },
  ],
});
```

## Resilience policies

The package provides REST-client versions of `@Resilience`, `@Retry`, `@Timeout`, `@CircuitBreaker`, `@Bulkhead`, `@OutboundRateLimit` and `@Fallback`. They read the same resilience settings as `@nestjs/resilience` and apply them to outbound requests. Install `@nestjs/resilience` separately; it is an optional peer dependency. Check its NestJS peer dependency before installing: version `0.0.3` supports NestJS 12, not NestJS 11.

```bash
npm install @nestjs/resilience
```

Class-level decorators configure resilience defaults for each client. Register multiple client classes in the same `forRootAsync()` call and provide the optional `@nestjs/resilience` service:

```ts
import { Module } from '@nestjs/common';
import { ResilienceModule, ResilienceService } from '@nestjs/resilience';
import {
  Bulkhead,
  CircuitBreaker,
  Endpoint,
  Fallback,
  Get,
  OutboundRateLimit,
  Retry,
  RestClient,
  RestClientModule,
  Timeout,
} from '@sarqdev/nest-rest-client';
import type {
  RestClientFallbackContext,
  RestClientResilienceModuleOptions,
} from '@sarqdev/nest-rest-client';

interface Product {
  id: string;
  name: string;
}

interface Invoice {
  id: string;
  total: number;
}

const resilienceOptions: RestClientResilienceModuleOptions = {
  defaults: { timeout: '3s' },
};

@Module({
  imports: [
    RestClientModule.forRootAsync({
      imports: [ResilienceModule.forRoot(resilienceOptions)],
      resilience: { service: ResilienceService, options: resilienceOptions },
      useFactory: () => [
        { client: CatalogClient },
        { client: BillingClient },
      ],
    }),
  ],
})
export class AppModule {}

@RestClient({ url: () => process.env.CATALOG_API_URL || '' })
@Retry({ attempts: 3 })
@Timeout('2s')
@CircuitBreaker({ name: 'catalog-api', minimumCalls: 10, openDuration: '30s' })
@Bulkhead({ name: 'catalog-api', maxConcurrent: 20, maxQueue: 40 })
@OutboundRateLimit({ name: 'catalog-api', limit: 100, interval: '1s' })
@Fallback('fallbackProduct')
export class CatalogClient {
  @Get('/v1/products/:id')
  @Timeout('1.5s')
  getProduct!: Endpoint<[id: string], Product>;

  fallbackProduct(_error: unknown, _context: RestClientFallbackContext): Product {
    return {id: 'unavailable', name: 'Product unavailable'};
  }
}

@RestClient({ url: () => process.env.BILLING_API_URL || '' })
@Retry(false)
@Timeout('5s')
@CircuitBreaker({ name: 'billing-api', minimumCalls: 5 })
export class BillingClient {
  @Get('/v1/invoices/:id')
  getInvoice!: Endpoint<[id: string], Invoice>;
}
```

The example registers two independent clients in one `forRootAsync()` call. Class-level resilience decorators apply to all endpoints on that client; endpoint-level decorators can override a stage for one endpoint. `@Resilience('catalog')` can be used to select a named preset configured under `presets`; `catalog` is simply the chosen preset key. `@Retry({ attempts: 3, idempotent: true })` explicitly enables retries for a non-safe HTTP method; otherwise retries are disabled for methods other than GET, HEAD and OPTIONS.

`@Fallback` can be applied to a client or endpoint and accepts a callback or the name of a regular client-class method. Its handler receives the error and a `RestClientFallbackContext`. The integration composes retry, timeout, circuit breaker, bulkhead, outbound rate-limit and fallback stages through `ResilienceService.create()`, caching a policy per decorated endpoint. Named stateful stages share state across endpoints configured with the same name. Timeout and caller cancellation signals are passed to Axios. You can also use `config.resilience` with a prebuilt policy or a per-endpoint selector.

## Response parsing

JSON responses are parsed when Axios has not already parsed them. String bodies that look like JSON (`{` or `[`) are also parsed when possible; malformed JSON and other text, including HTML, remain strings. Use `@Returns(Dto)` when you want the response transformed to a DTO class; `Endpoint<..., Dto>` alone only provides a TypeScript return type.

```ts
@RestClient({
  url: 'https://example.com',
})
export class HtmlClient {
  @Get('/page')
  getPage!: Endpoint<[], string>;
}
```

## NestJS conventions

A typical NestJS setup is:
- one root module registers all clients
- `forFeature` exposes only the needed subset to a feature module
- the root registration is a global dynamic module; `forFeature` makes selected client tokens available to feature modules

Avoid registering multiple independent root registries in the same application, because the library stores clients in one shared registry keyed by class.

## Notes

- Use `Endpoint<[...args], T>` to type arguments and return values.
- `GET` payloads are converted to query params automatically.
- `forRoot` is a convenience wrapper around static registration.
- `forRootAsync` is the correct choice when configuration is async or injected.

## API reference

The following APIs are exported from the package root (`@sarqdev/nest-rest-client`).

### Decorators

| API | Description |
|---|---|
| `RestClient` | Declares a client's base URL, headers, and default content type. |
| `ContentType` | Sets a client- or endpoint-level content type. |
| `Returns` | Configures response DTO transformation and class-transformer options. |
| `ClassTransformOptions` | Sets class-transformer metadata for an endpoint. |
| `Get`, `Post`, `Put`, `Delete`, `Patch`, `Head`, `Options` | Declare an endpoint's HTTP method and path. |
| `PathParam` | Binds a method argument to a named path placeholder. |
| `QueryParam` | Binds a method argument to a named query parameter. |
| `Payload` | Marks a method argument as the request payload. |
| `Resilience` | Selects a named resilience preset for a client or endpoint. |
| `Retry`, `Timeout`, `CircuitBreaker`, `Bulkhead`, `OutboundRateLimit`, `Fallback` | Configure resilience stages on a client or endpoint. |

### Modules and functions

| API | Description |
|---|---|
| `RestClientModule` | Registers clients using `forRoot`, `forRootAsync`, or `forFeature`. |
| `RestClientFactory` | Creates the REST-client providers for a registration. |
| `createNestRestClient` | Creates a REST-client proxy from a decorated client class. |
| `getAuthProviderToken` | Resolves the Nest injection token from an auth provider definition. |
| `getResilienceSettings`, `createResilienceOptions` | Read client resilience metadata and produce `ResilienceService.create()` options. |

### Types and interfaces

| API | Description |
|---|---|
| `Endpoint<TArgs, TResult>`, `EndpointDecorator` | Type a declared endpoint and its decorators. |
| `RestClientOptions`, `RestClientDecoratorOptions` | Type module registration options and `@RestClient` options, respectively. |
| `RestClientConfig`, `RestClientAsyncOptions` | Type client configuration and async module registration. |
| `RestRequestConfig` | Type per-call headers, params, content type, and abort signal. |
| `RestAuth`, `RestAuthProvider` | Type an auth provider and Nest provider forms. |
| `MethodMetadata`, `ReturnMetadata` | Type HTTP endpoint metadata and response DTO metadata. |
| `RestClientResiliencePolicy`, `RestClientResilienceAttempt`, `RestClientResilienceContext` | Type policy execution and policy-selection context. |
| `RestClientResilienceService`, `RestResiliencePolicy`, `RestClientResilienceModuleOptions`, `RestClientResilienceSettings`, `ResiliencePresetOptions` | Type the optional resilience service, policy, and configuration. |
| `ResilienceDuration`, `RetryOptions`, `BackoffOptions`, `CircuitBreakerOptions`, `BulkheadOptions`, `OutboundRateLimitOptions`, `FallbackOptions` | Type resilience stage durations and options. |
| `RestClientFallbackContext`, `RestClientFallbackHandler` | Type REST-client fallback context and handler. |

### Constants

| API | Description |
|---|---|
| `ContentTypes` | Content-type values for JSON, form data, multipart, text, HTML, binary, XML, YAML, Protobuf, and GraphQL. |
| `LOGGER` | The library's Nest logger instance. |
| `METHOD_METADATA`, `ENDPOINTS_METADATA` | Metadata keys for HTTP endpoint declarations. |
| `PATH_PARAM_METADATA`, `PAYLOAD_METADATA`, `QUERY_PARAM_METADATA` | Metadata keys for endpoint argument decorators. |
| `REST_CLIENT_METADATA`, `REST_CLIENT_CONTENT_TYPE`, `RETURNS_METADATA` | Metadata keys for client configuration and response transformation. |

## License

MIT
