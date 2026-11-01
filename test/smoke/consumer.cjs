require('reflect-metadata');

const assert = require('node:assert/strict');
const http = require('node:http');
const {Module} = require('@nestjs/common');
const {NestFactory} = require('@nestjs/core');
const {Expose} = require('class-transformer');
const {
  Get,
  Returns,
  RestClient,
  RestClientModule,
  Retry,
} = require('@sarqdev/nest-rest-client');

class UserDto {}
Expose()(UserDto.prototype, 'id');
Expose()(UserDto.prototype, 'name');

class SmokeClient {
  getUser() {}
}
RestClient({url: () => process.env.SMOKE_BASE_URL})(SmokeClient);
Get('/users/42')(SmokeClient.prototype, 'getUser', Object.getOwnPropertyDescriptor(SmokeClient.prototype, 'getUser'));
Returns(UserDto)(SmokeClient.prototype, 'getUser', Object.getOwnPropertyDescriptor(SmokeClient.prototype, 'getUser'));

class SmokeModule {}

async function main() {
  let retryAttempts = 0;
  const server = http.createServer((request, response) => {
    if (request.url === '/users/42') {
      response.writeHead(200, {'content-type': 'application/json'});
      response.end(JSON.stringify({id: 42, name: 'smoke-test', ignored: true}));
      return;
    }

    if (request.url === '/retry') {
      retryAttempts += 1;
      if (retryAttempts === 1) {
        response.writeHead(503);
        response.end('temporarily unavailable');
        return;
      }

      response.writeHead(200, {'content-type': 'application/json'});
      response.end(JSON.stringify({ok: true}));
      return;
    }

    response.writeHead(404);
    response.end();
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });

  const address = server.address();
  process.env.SMOKE_BASE_URL = `http://127.0.0.1:${address.port}`;

  let app;
  try {
    const clients = [{client: SmokeClient}];
    const imports = [];
    if (process.env.SMOKE_WITH_RESILIENCE === '1') {
      const {ResilienceModule, ResilienceService} = await import('@nestjs/resilience');
      class ResilientClient {
        getStatus() {}
      }
      RestClient({url: () => process.env.SMOKE_BASE_URL})(ResilientClient);
      Get('/retry')(ResilientClient.prototype, 'getStatus', Object.getOwnPropertyDescriptor(ResilientClient.prototype, 'getStatus'));
      Retry({attempts: 2, backoff: {delay: 1}, retryIf: () => true})(
        ResilientClient.prototype,
        'getStatus',
        Object.getOwnPropertyDescriptor(ResilientClient.prototype, 'getStatus'),
      );
      clients.push({client: ResilientClient});
      const resilienceModule = ResilienceModule.forRoot();
      const clientsModule = RestClientModule.forRootAsync({
        imports: [resilienceModule],
        useFactory: () => clients,
        resilience: {service: ResilienceService},
      });
      imports.push(resilienceModule, clientsModule);
      imports.push(RestClientModule.forFeature([SmokeClient, ResilientClient]));
      Module({imports})(SmokeModule);
      app = await NestFactory.createApplicationContext(SmokeModule, {logger: false});

      const resilientClient = app.get(ResilientClient);
      assert.deepEqual(await resilientClient.getStatus(), {ok: true});
      assert.equal(retryAttempts, 2, 'the resilience integration should retry the transient HTTP failure');
    } else {
      imports.push(RestClientModule.forRoot(clients));
      imports.push(RestClientModule.forFeature([SmokeClient]));
      Module({imports})(SmokeModule);
      app = await NestFactory.createApplicationContext(SmokeModule, {logger: false});
    }

    const client = app.get(SmokeClient);
    const user = await client.getUser();
    assert.ok(user instanceof UserDto, 'the response should be transformed to the declared DTO');
    assert.deepEqual(user, Object.assign(new UserDto(), {id: 42, name: 'smoke-test'}));
    assert.equal(Object.hasOwn(user, 'ignored'), false, 'excluded response fields should be omitted');
  } finally {
    await app?.close();
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
