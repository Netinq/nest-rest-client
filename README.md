# nest-rest-client

A NestJS utility to declare REST clients as typed classes and call them like proxied methods.

## Installation

```bash
npm install @sarqdev/nest-rest-client
```

## Quick start

Create a client class with `@RestClient`, decorate it with `@ContentType` if needed, and declare each endpoint as a typed property.

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

Then register it in your module:

```ts
import { Module } from '@nestjs/common';
import { RestClientModule } from '@sarqdev/nest-rest-client';
import { ApiRestClient } from './api-rest.client';

@Module({
 imports: [
   RestClientModule.forRootAsync({
     useFactory: () => [
       {
         client: ApiRestClient,
         config: {
           headers: {
             'X-Global': 'app',
           },
         },
       },
     ],
   }),
   RestClientModule.forFeature([ApiRestClient]),
 ],
})
export class AppModule {}
```

You can inject it later:

```ts
import { Injectable } from '@nestjs/common';

@Injectable()
export class FooService {
 constructor(private readonly client: ApiRestClient) {}

 async list() {
   return this.client.getFoo();
 }

 async create(data: { name: string }) {
   return this.client.createFoo(data);
 }
}
```

## How arguments are bound

Arguments are matched by position.

- path params first
- then query params or payload
- for `GET`, payload is converted to query parameters if present
- for non-GET, payload becomes `axiosConfig.data`

### Example with path + payload

```ts
@RestClient({ url: 'https://api.example.com' })
export class UserClient {
 @Get('/users/:id')
 getUser!: Endpoint<[id: string], User>;

 @Post('/users')
 createUser!: Endpoint<[body: CreateUserDto], User>;
}
```

Usage:

```ts
await client.getUser('123');
await client.createUser({ name: 'Alice' });
```

### Example with query params

```ts
@RestClient({ url: 'https://api.example.com' })
export class SearchClient {
 @Get('/search')
 search!: Endpoint<[q: string, page: number], SearchResult>;
}
```

This is equivalent to:

```ts
GET https://api.example.com/search?q=nestjs&page=2
```

Usage:

```ts
await client.search('nestjs', 2);
```

### Example with body on GET

```ts
@RestClient({ url: 'https://api.example.com' })
export class SearchClient {
 @Get('/search')
 searchWithBody!: Endpoint<[filters: Record<string, any>], SearchResult>;
}
```

Usage:

```ts
await client.searchWithBody({ category: 'books', page: 1 });
```

This library turns the GET payload into query params automatically.

## Decorators

### @RestClient

```ts
@RestClient({
 url: 'https://api.example.com',
 headers: {
   'X-App': 'demo',
 },
 contentType: ContentTypes.JSON,
})
```

Properties:

| Property | Type | Description |
| --- | --- | --- |
| url | `string | (() => string)` | Base URL of the API |
| headers | `Record<string, string>` | Default headers for all requests of this client |
| contentType | `ContentTypes | string` | Default `Content-Type` for the client, overridable per request |

### @ContentType

```ts
@ContentType(ContentTypes.JSON)
```

This sets the default `Content-Type` header for the client. You can still override it on a specific request by passing `headers: { 'Content-Type': '...' }` or `contentType: '...'` in the request config object.

### @Get / @Post / @Put / @Delete / @Patch

Define the HTTP method and route.

```ts
@Get('/users/:id')
```

### @Returns

Type the result and optionally configure `class-transformer`.

```ts
@Get('/users/:id')
getUser!: Endpoint<[id: string], User>;
```

## Headers

You can set headers at three levels.

### 1. Client level

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

`contentType` and `@ContentType(...)` both set the default `Content-Type` for the class, but a request can override it.

### 2. Module level

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

### 3. Request level

```ts
await client.getStatus({
 headers: {
   'X-Trace-Id': 'abc-123',
   'Content-Type': ContentTypes.TEXT_PLAIN,
 },
});
```

Or with the convenience field:

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
2. module-level config.headers
3. client-level `@RestClient({ headers, contentType })` / `@ContentType(...)`
4. auth headers (`Authorization`)

### Example with auth

```ts
export class MyAuth implements RestAuth {
 async getToken(): Promise<string> {
   return 'token';
 }

 async refreshToken(): Promise<void> {
   // refresh
 }
}
```

```ts
RestClientModule.forRootAsync({
 authProviderInject: [MyAuth],
 useFactory: () => [
   {
     client: ApiClient,
     authProvider: MyAuth,
     config: {
       headers: {
         'X-System': 'backend',
       },
     },
   },
 ],
});
```

This automatically injects Authorization: Bearer <token>.

## Request config override

If you need a custom header or content type for a single call, pass an object as the last argument:

```ts
await client.getFoo({
 headers: {
   'X-Trace-Id': 'my-trace',
   'Content-Type': ContentTypes.TEXT_PLAIN,
 },
});
```

Or with the shortcut:

```ts
await client.getFoo({
 contentType: ContentTypes.TEXT_PLAIN,
 headers: {
   'X-Trace-Id': 'my-trace',
 },
});
```

For a call with path params + request config:

```ts
await client.getFooById('42', {
 headers: {
   'X-Trace-Id': 'my-trace',
 },
});
```

For a body request with request config:

```ts
await client.createFoo(
 { name: 'Alice' },
 {
   headers: {
     'X-Trace-Id': 'my-trace',
   },
 },
);
```

You can also pass `params` in the request config:

```ts
await client.search('nestjs', {
 params: {
   page: 2,
   order: 'desc',
 },
});
```

## Method declaration styles

### Declarative style (recommended)

```ts
@RestClient({ url: 'https://api.example.com' })
export class Client {
 @Get('/users/:id')
 getUser!: Endpoint<[id: string], User>;
}
```

Use this when you want the proxy to generate the method automatically.

### Decorator-based binding style

```ts
@RestClient({ url: 'https://api.example.com' })
export class Client {
 @Get('/users/:id')
 getUser(
   @PathParam('id') id: string,
   @QueryParam('include') include?: string,
 ): Promise<User> {
   throw new Error('Not implemented - replaced by the proxy.');
 }
}
```

This style is useful when you need explicit parameter mapping.

## Automatic JSON parsing

JSON responses are parsed automatically when content is JSON.

HTML or plain text responses are returned as raw strings.

```ts
@RestClient({ url: 'https://example.com' })
export class HtmlClient {
 @Get('/page')
 getPage!: Endpoint<[], string>;
}
```

## Full example

```ts
import {
 RestClient,
 ContentType,
 ContentTypes,
 Get,
 Post,
 Endpoint,
 RestClientModule,
} from '@sarqdev/nest-rest-client';

interface User {
 id: string;
 name: string;
}

@RestClient({
 url: 'https://api.example.com',
 headers: {
   'X-App': 'demo',
 },
})
@ContentType(ContentTypes.JSON)
export class UserClient {
 @Get('/users')
 listUsers!: Endpoint<[], User[]>;

 @Get('/users/:id')
 getUser!: Endpoint<[id: string], User>;

 @Post('/users')
 createUser!: Endpoint<[body: { name: string }], User>;
}

@Module({
 imports: [
   RestClientModule.forRootAsync({
     useFactory: () => [
       {
         client: UserClient,
         config: {
           headers: {
             'X-Env': 'prod',
           },
         },
       },
     ],
   }),
   RestClientModule.forFeature([UserClient]),
 ],
})
export class AppModule {}
```

Usage:

```ts
const users = await userClient.listUsers();
const user = await userClient.getUser('1');
const created = await userClient.createUser(
 { name: 'Alice' },
 { headers: { 'X-Trace-Id': 'trace-1' } },
);
```

## Notes

- Use `Endpoint<[...args], T>` to type the arguments and return value.
- The library automatically manages `Authorization` when an auth provider is configured.
- `GET` payloads are converted to query params.
- HTML or plain text bodies are not forced through `JSON.parse`.
