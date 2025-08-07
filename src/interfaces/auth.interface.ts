import {Provider, Type} from '@nestjs/common';

export interface RestAuth {
  getToken(): Promise<string>;
  refreshToken?(): Promise<void>;
}

export type RestAuthProvider = Type<RestAuth> | Provider<RestAuth>;
