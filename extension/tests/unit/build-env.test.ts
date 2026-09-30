import { afterEach, describe, expect, it, vi } from 'vitest';
import { assertBuildEnv, irisBuildEnv, irisDefines } from '../../build-env.ts';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('build settings', () => {
  it('uses the local backend when IRIS_API_BASE is unset in development', () => {
    vi.stubEnv('IRIS_API_BASE', '');
    const env = irisBuildEnv('development');
    expect(env.apiBase).toBeNull();
    expect(irisDefines(env).__IRIS_API_BASE__).toBe('"http://localhost:8000/api"');
  });

  it('refuses a production build without IRIS_API_BASE', () => {
    vi.stubEnv('IRIS_API_BASE', '');
    expect(() => {
      assertBuildEnv('production');
    }).toThrow(/IRIS_API_BASE/);
  });

  it('bakes in the configured base without a trailing slash', () => {
    vi.stubEnv('IRIS_API_BASE', 'https://iris.example.com/api/');
    vi.stubEnv('IRIS_DEBUG', 'true');
    const env = irisBuildEnv('production');
    expect(env).toEqual({ apiBase: 'https://iris.example.com/api', mockVoice: false, debug: true });
    expect(() => {
      assertBuildEnv('production');
    }).not.toThrow();
  });
});
