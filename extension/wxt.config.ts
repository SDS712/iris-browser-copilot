import { join } from 'node:path';
import preact from '@preact/preset-vite';
import { defineConfig } from 'wxt';
import { assertBuildEnv, irisBuildEnv, irisDefines } from './build-env.ts';
import { buildWorklet } from './build-worklet.ts';
import { FONT_FILES } from './src/ui/fonts.ts';

/** The public half of the key in .keys/iris.pem (`pnpm gen:key`): it fixes the extension ID. */
const MANIFEST_KEY =
  'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAza78FA/2kX/rGTNu/CTunIn3taIQQ1MnSxONa97RpZxjvOZ4mQdh3Sg2tcOX70uYgkWatLkIR7rd+t3WGzG4Yn3hjkPRGfNwPj6Yyd1YdBmd/g0oMMzlq/+hAIu9kt0Spw6r57IoixaUlNmaRn377/GnnQsmBHdvEel6v87Gi+BOnQOuC1cG0EUrz9wefRPb9ANavEy01JbM9LuqpYc2BQ/R4Wwwa1wSlBNx6RSQngzX/329MFM9dI8tDXyYE95eFbtAUczdK2JyFzC0m36CDYwHOPnN/GqT1gxx/96hN2PhEkT2oM0M48mQTTfyNdSMy6GJDQJgtmEDICTf0hUbsQIDAQAB';

const FONTS_DIR = join(import.meta.dirname, 'node_modules', '@fontsource', 'inter', 'files');

export default defineConfig({
  imports: false,
  targetBrowsers: ['chrome'],
  vite: ({ mode }) => ({
    plugins: [preact()],
    define: irisDefines(irisBuildEnv(mode)),
  }),
  hooks: {
    'build:before': (wxt) => {
      assertBuildEnv(wxt.config.mode);
    },
    // The capture worklet must be its own plain script, and the overlay needs the fonts.
    'build:publicAssets': async (_wxt, assets) => {
      assets.push({ relativeDest: 'pcm-worklet.js', contents: await buildWorklet() });
      for (const file of FONT_FILES) {
        assets.push({ relativeDest: `fonts/${file}`, absoluteSrc: join(FONTS_DIR, file) });
      }
    },
  },
  manifest: {
    name: 'Iris',
    description:
      'A second pair of eyes on every page: a voice copilot that reads the page with you.',
    minimum_chrome_version: '116',
    key: MANIFEST_KEY,
    permissions: ['sidePanel', 'storage', 'tabs', 'scripting'],
    host_permissions: ['<all_urls>'],
    web_accessible_resources: [
      { resources: ['fonts/*.woff2', 'pcm-worklet.js'], matches: ['<all_urls>'] },
    ],
    action: {
      default_title: 'Iris',
      default_icon: { 16: 'icon/16.png', 32: 'icon/32.png' },
    },
    commands: {
      'toggle-iris': {
        suggested_key: { default: 'Alt+Shift+I' },
        description: 'Open Iris and start or end a session',
      },
    },
  },
});
