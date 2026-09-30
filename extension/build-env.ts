import { loadEnv } from 'vite';

/** Build-time settings, read from `.env` files and the environment. */
export interface IrisBuildEnv {
  /** Null when not set; development builds then use the local backend. */
  apiBase: string | null;
  mockVoice: boolean;
  debug: boolean;
}

const DEV_API_BASE = 'http://localhost:8000/api';

export function irisBuildEnv(mode: string): IrisBuildEnv {
  const env = loadEnv(mode, import.meta.dirname, 'IRIS_');
  const apiBase = env.IRIS_API_BASE?.trim().replace(/\/+$/, '');
  return {
    apiBase: apiBase || null,
    mockVoice: env.IRIS_MOCK_VOICE === 'true',
    debug: env.IRIS_DEBUG === 'true',
  };
}

/** Production builds must say which backend they talk to. */
export function assertBuildEnv(mode: string): void {
  if (mode === 'production' && !irisBuildEnv(mode).apiBase) {
    throw new Error('IRIS_API_BASE must be set for production builds (see .env.example).');
  }
}

/** Vite `define` entries, so disabled debug and mock code is dropped from the bundle. */
export function irisDefines(env: IrisBuildEnv): Record<string, string> {
  return {
    __IRIS_API_BASE__: JSON.stringify(env.apiBase ?? DEV_API_BASE),
    __IRIS_MOCK_VOICE__: JSON.stringify(env.mockVoice),
    __IRIS_DEBUG__: JSON.stringify(env.debug),
  };
}
