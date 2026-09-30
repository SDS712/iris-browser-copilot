import { createApi } from '../src/core/api';
import type { IrisAppOptions } from '../src/core/app';
import { localSettings } from '../src/core/settings';
import { loadIrisFonts } from '../src/ui/fonts';

/** The test flags, read from the page URL. */
export function urlFlag(name: string): boolean {
  return new URLSearchParams(location.search).get(name) === '1';
}

/** The bundled capture worklet, served by the harness's dev server (vite.widget.config.ts). */
export const DEV_WORKLET_URL = '/pcm-worklet.js';

/** App options for harness pages: the widget's platform, with fonts from /fonts/. */
export function harnessOptions(): IrisAppOptions {
  loadIrisFonts((file) => `/fonts/${file}`);
  return {
    api: createApi('/api'),
    platform: { kind: 'widget', settings: localSettings() },
    mockVoice: urlFlag('iris_mock_voice'),
    debug: urlFlag('iris_debug'),
    workletUrl: DEV_WORKLET_URL,
  };
}
