import { browser } from 'wxt/browser';
import { defineBackground } from 'wxt/utils/define-background';
import { startBackground } from '../src/extension/background-main';

export default defineBackground(() => {
  startBackground(browser);
});
