// The demo site: static output with directory URLs, and /api forwarded to the
// backend on port 8000 while developing.
import { defineConfig, envField } from 'astro/config';

export default defineConfig({
  site: process.env.IRIS_PUBLIC_URL || 'http://localhost:4321',
  output: 'static',
  build: { format: 'directory' },
  trailingSlash: 'ignore',
  // The demo video is recorded on `pnpm dev`: no Astro toolbar over the pages.
  devToolbar: { enabled: false },
  env: {
    schema: {
      IRIS_PUBLIC_URL: envField.string({
        context: 'server',
        access: 'public',
        default: 'http://localhost:4321',
      }),
      IRIS_VIDEO_URL: envField.string({ context: 'server', access: 'public', default: '' }),
      IRIS_GITHUB_URL: envField.string({ context: 'server', access: 'public', default: '' }),
      // The in-page widget on /demo/* pages: on, so visitors can try Iris without the extension.
      IRIS_DEMO_WIDGET: envField.boolean({ context: 'server', access: 'public', default: true }),
      // Where the widget sends its requests: this site's /api, or the backend's full URL.
      IRIS_API_BASE: envField.string({ context: 'server', access: 'public', default: '/api' }),
    },
  },
  vite: {
    server: {
      proxy: { '/api': 'http://localhost:8000' },
      // The landing page shows the Iris glyph straight from the extension's assets.
      fs: { allow: ['..'] },
    },
  },
});
