/**
 * iris-widget.js: reads its own <script> tag and URL, then starts the
 * widget and exposes window.Iris.
 *
 *   <script src="/widget/iris-widget.js" defer data-api-base="/api" data-nudges="on"
 *           data-open="false"></script>
 */
import { startWidget, type IrisHandle } from './start';

declare global {
  interface Window {
    Iris?: IrisHandle;
  }
}

function boot(script: HTMLScriptElement | null): void {
  if (window.Iris) return;
  const scriptUrl = script?.src ?? location.href;
  const flags = new URLSearchParams(location.search);
  const widget = startWidget({
    apiBase: script?.dataset.apiBase ?? '/api',
    assetUrl: (path) => new URL(path, scriptUrl).href,
    nudges: script?.dataset.nudges !== 'off',
    open: script?.dataset.open === 'true',
    mockVoice: flags.get('iris_mock_voice') === '1',
    debug: flags.get('iris_debug') === '1',
  });
  window.Iris = { open: widget.open, close: widget.close, isOpen: widget.isOpen };
}

// document.currentScript only exists while the script first runs.
const script = document.currentScript as HTMLScriptElement | null;
if (document.readyState === 'loading') {
  document.addEventListener(
    'DOMContentLoaded',
    () => {
      boot(script);
    },
    { once: true },
  );
} else boot(script);
