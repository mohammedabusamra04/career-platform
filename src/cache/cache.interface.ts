export interface Cache {
  set<T>(key: string, value: T, ttl?: number): Promise<void>;

  setIfNotExists<T>(key: string, value: T, ttl?: number): Promise<boolean>;

  get<T>(key: string): Promise<T | null>;

  delete(key: string): Promise<void>;
}

export type ICache = Cache;

