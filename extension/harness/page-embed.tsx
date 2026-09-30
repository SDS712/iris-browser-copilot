/**
 * Dev harness for fixture pages (/pages/<name>.html): the real widget, started from source
 * with the panel open, fonts from /fonts/ and the bundled worklet from the dev server.
 */
import { startWidget } from '../src/widget/start';
import { urlFlag } from './flags';

startWidget({
  apiBase: '/api',
  assetUrl: (path) => `/${path}`,
  nudges: true,
  open: true,
  mockVoice: urlFlag('iris_mock_voice'),
  debug: urlFlag('iris_debug'),
});
