import axios from 'axios';
import { createNestRestClient } from '../../src/client';
import { Get, Post } from '../../src/decorators/methods';
import { RestClient, ContentType } from '../../src/decorators/rest';
import ContentTypes from '../../src/constants/ContentTypes';
import { Endpoint } from '../../src/types/endpoint';

jest.mock('axios');
const axiosMock = axios as unknown as jest.MockedFunction<typeof axios>;

interface User {
  id: number;
  name: string;
}

@RestClient({ url: 'https://api.example.com' })
@ContentType(ContentTypes.JSON)
class ApiRestClient {
  @Get('/v1/foo')
  getFoo!: Endpoint<[], User[]>;

  @Get('/v1/users/:id')
  getUser!: Endpoint<[id: number], User>;

  @Post('/v1/users')
  createUser!: Endpoint<[body: { name: string }], User>;
}

describe('endpoints déclarés sans corps de méthode', () => {
  beforeEach(() => jest.clearAllMocks());

  it('appelle l’URL sans variable de chemin', async () => {
    axiosMock.mockResolvedValueOnce({ data: [{ id: 1, name: 'a' }] } as any);

    const client = createNestRestClient(ApiRestClient);
    const result = await client.getFoo();

    expect(axiosMock).toHaveBeenCalledWith(
      expect.objectContaining({
        url: 'https://api.example.com/v1/foo',
        method: 'GET',
        headers: expect.objectContaining({ 'Content-Type': 'application/json' }),
      }),
    );
    expect(result).toEqual([{ id: 1, name: 'a' }]);
  });

  it('associe les arguments aux variables de chemin par position', async () => {
    axiosMock.mockResolvedValueOnce({ data: { id: 42, name: 'b' } } as any);

    const client = createNestRestClient(ApiRestClient);
    await client.getUser(42);

    expect(axiosMock).toHaveBeenCalledWith(
      expect.objectContaining({ url: 'https://api.example.com/v1/users/42' }),
    );
  });

  it('utilise l’argument suivant comme payload', async () => {
    axiosMock.mockResolvedValueOnce({ data: { id: 1, name: 'c' } } as any);

    const client = createNestRestClient(ApiRestClient);
    await client.createUser({ name: 'c' });

    expect(axiosMock).toHaveBeenCalledWith(
      expect.objectContaining({
        url: 'https://api.example.com/v1/users',
        method: 'POST',
        data: { name: 'c' },
      }),
    );
  });
});
