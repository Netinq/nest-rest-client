export interface RestAuth {
  getToken(): Promise<string>;
  refreshToken?(): Promise<void>;
}
