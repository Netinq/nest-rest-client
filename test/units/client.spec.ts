import axios from 'axios';
import { RestAuth } from '../../src/interfaces/auth.interface';
import { createNestRestClient } from '../../src/client';
import { Get } from '../../src/decorators/methods';
import {PathParam} from '../../src/decorators/requestContext';
import {RestClient} from '../../src/decorators/rest';

jest.mock('axios');
const axiosMock = axios as jest.MockedFunction<typeof axios>;

@RestClient({
  url: () => 'https://api.example.com/data',
})
class TestClient {
  @Get('/v1/test/:id')
  getData(@PathParam('id') id: number): Promise<{ value: number }> {
    // Le corps ne sera pas appelé, remplacé par proxy
    throw new Error('Method not implemented.');
  }
}

const authMock: RestAuth = {
  getToken: jest.fn().mockResolvedValue('mocked-token'),
  refreshToken: jest.fn().mockResolvedValue('mocked-token'),
};

describe('TestClient REST client', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should call axios with correct URL and Authorization header', async () => {
    axiosMock.mockResolvedValueOnce({ data: { value: 42 } });

    const client = createNestRestClient(TestClient, undefined, authMock);
    const result = await client.getData(1);

    expect(authMock.getToken).toHaveBeenCalledTimes(1);
    expect(axiosMock).toHaveBeenCalledWith(
      expect.objectContaining({
        url: 'https://api.example.com/data/v1/test/1',
        method: 'GET',
        headers: expect.objectContaining({
          Authorization: 'Bearer mocked-token',
          'Content-Type': expect.any(String), // selon ta config
        }),
      }),
    );
    expect(result.value).toBe(42);
  });

  it('should refresh token once on 401 response and retry', async () => {
    axiosMock.mockRejectedValueOnce({ response: { status: 401 } });
    axiosMock.mockResolvedValueOnce({ data: { value: 123 } });

    const client = createNestRestClient(TestClient, undefined, authMock);
    const result = await client.getData(2);

    expect(authMock.getToken).toHaveBeenCalledTimes(2); // une fois avant 1er call, une fois avant retry
    expect(authMock.refreshToken).toHaveBeenCalledTimes(1);
    expect(axiosMock).toHaveBeenCalledTimes(2);
    expect(result.value).toBe(123);
  });
});
