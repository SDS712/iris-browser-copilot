import { defineConfig } from 'vitest/config';
import { WxtVitest } from 'wxt/testing/vitest-plugin';
import { irisDefines } from './build-env.ts';

export default defineConfig({
  plugins: [WxtVitest()],
  define: irisDefines({ apiBase: null, mockVoice: false, debug: false }),
  test: {
    environment: 'happy-dom',
    include: ['tests/unit/**/*.test.{ts,tsx}'],
    restoreMocks: true,
  },
});
