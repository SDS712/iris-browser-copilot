import { browser } from 'wxt/browser';
import { defineContentScript } from 'wxt/utils/define-content-script';
import { startContentScript } from '../src/extension/content-main';

export default defineContentScript({
  matches: ['<all_urls>'],
  runAt: 'document_idle',
  allFrames: false,
  main() {
    startContentScript(browser, __IRIS_DEBUG__);
  },
});
