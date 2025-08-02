<p align="center">
  <a href="http://nestjs.com"><img alt="Nest Logo" src="https://nestjs.com/img/logo-small.svg" width="120"></a>
</p>

<h1 align="center">
  nest-rest-client
</h1>

<p align="center">
  <a href="https://www.npmjs.com/package/nest-rest-client"><img alt="NPM version" src="https://img.shields.
io/npm/v/nest-rest-client.
svg"></a>
  <a href="https://www.npmjs.com/package/nest-rest-client"><img alt="NPM downloads" src="https://img.shields.io/npm/dw/nest-rest-client.svg"></a>
</p>

<p align="center">
  A <a href="https://github.com/nestjs/nest">Nest</a> module to create insane REST Client.
</p>

**Table of Contents**

- [Installation](#installation)
- [Quick start](#quick-start)
- [Reference](#reference)
  - [Decorators](#decorators)
    - [@RestClient](#restclient)
    - [@ContentType](#contenttype)

## Installation

```bash
npm install nest-rest-client
```

## Quick start

Create a REST client by extending the `RestClient` decorator and using the `@Get`, `@Post`, etc. decorators to define your endpoints.
```typescript
/* exemple.client.ts */
import {RestClient} from 'nest-rest-client/dist/decorators/rest';
import ContentTypes from 'nest-rest-client/dist/constants/ContentTypes';

@RestClient({
  url: "https://api.example.com",
})
@ContentType(ContentTypes.JSON)
export class ApiRestClient {
  @Get('/v1/foo')
  async getFoo(): Promise<null> {
    return null;
  }
}
```

Then, you can import the `RestClientModule` in your main application module and configure it with your REST client class.
```typescript
import { RestClientModule } from 'nest-rest-client/dist/client.module';
@Module({
  imports: [
    RestClientModule.forRoot({
      client: ApiRestClient,
      deps: [],
      inject: [],
      config: {},
    }),
  ],
})
export class AppModule {}
```

Next, you can inject your REST client into any service or controller where you need to use it.
```typescript
@Module({
  imports: [
  ],
  controllers: [],
  providers: [ApiRestClient],
})
export class BarModule {}
```

And finally, you can use the REST client in your service or controller.
```typescript
@Injectable()
export class BarService {

  constructor(private readonly client: MyRestClient) { }
  
  async getFoo(): Promise<null> {
    this.LOGGER.log('Calling getFoo()');
    return this.client.getFoo();
  }
}
```

## Reference
### Decorators
#### @RestClient
The `@RestClient` decorator is used to define a REST client class. It takes an options object that can include the base URL for the API.

| Property | Type | Description |
| -------- | ---- | ----------- |
| url | `string` | The base URL for the REST API. |
#### @ContentType
The `@ContentType` decorator is used to specify the content type for the REST client. It takes a content type string as an argument.

| Property | Type         | Description |
| -------- |--------------| ----------- |
| contentType | `ContentType` | The content type for the REST client. |

#### @Returns
The `@Returns` decorator is used to specify the expected return type of a REST client method. It takes a type argument that represents the expected return type.
Using `class-transformer` is recommended to ensure that the response is properly transformed into the expected type.
Check the [NestJS Serialization](https://docs.nestjs.com/techniques/serialization) documentation for more details.

| Property | Type         | Description |
| -------- |--------------| ----------- |
| type     | `Type<T>`    | The expected return type of the REST client method. |
