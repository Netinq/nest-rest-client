# nest-rest-client

A NestJS utility to declare REST clients as typed classes and call them like proxied methods.

## Installation

```bash
npm install @sarqdev/nest-rest-client
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
              Authorization: `Bearer ${config.get('API_TOKEN')}`,
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
    RestClientModule.forFeature([UserClient]),
  ],
})
export class UserModule {}
```

This is the recommended pattern when you want to avoid `@Global()`:
- one root module creates the clients
- each feature module imports only what it needs via `forFeature`

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

Arguments are matched by position:
- path params first
- then query params or payload
- for `GET`, payload becomes query parameters
- for non-GET, payload becomes the request body

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

Priority is:
1. request-level `headers['Content-Type']` / `contentType`
2. module-level `config.headers`
3. client-level `@RestClient({ headers, contentType })` / `@ContentType(...)`
4. auth headers such as `Authorization`

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

## Response parsing

HTML or plain text responses are not forced through `JSON.parse`.

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

A clean NestJS setup is:
- one root module registers all clients
- `forFeature` exposes only the needed subset to a feature module
- `@Global()` is optional and only needed if you want a global shortcut

Avoid registering multiple independent root registries in the same application, because the library stores clients in one shared registry keyed by class.

## Notes

- Use `Endpoint<[...args], T>` to type arguments and return values.
- `GET` payloads are converted to query params automatically.
- `forRoot` is a convenience wrapper around static registration.
- `forRootAsync` is the correct choice when configuration is async or injected.
