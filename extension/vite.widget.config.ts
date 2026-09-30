import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import preact from '@preact/preset-vite';
import { defineConfig, type Plugin } from 'vite';
import { buildWorklet } from './build-worklet.ts';

/** Serves the bundled capture worklet at /pcm-worklet.js, as the widget build lays it out. */
function devWorklet(): Plugin {
  let code: Promise<string> | null = null;
  return {
    name: 'iris-dev-worklet',
    apply: 'serve',
    configureServer(server) {
      server.watcher.on('change', (file) => {
        if (file.includes('/src/core/audio/') || file.includes('/src/widget/pcm-worklet')) {
          code = null;
        }
      });
      server.middlewares.use('/pcm-worklet.js', (_req, res, next) => {
        code ??= buildWorklet();
        code.then(
          (script) => {
            res.setHeader('Content-Type', 'text/javascript');
            res.end(script);
          },
          (error: unknown) => {
            code = null;
            next(error);
          },
        );
      });
    },
  };
}

/** Serves the Inter files at /fonts/, where the widget build puts them. */
function devFonts(): Plugin {
  const dir = join(import.meta.dirname, 'node_modules', '@fontsource', 'inter', 'files');
  return {
    name: 'iris-dev-fonts',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/fonts/', (req, res, next) => {
        const file = (req.url ?? '').replace(/^\//, '').split('?')[0] ?? '';
        if (!/^inter-[a-z-]+-\d{3}-normal\.woff2$/.test(file)) {
          next();
          return;
        }
        readFile(join(dir, file)).then(
          (data) => {
            res.setHeader('Content-Type', 'font/woff2');
            res.end(data);
          },
          () => {
            next();
          },
        );
      });
    },
  };
}

/** The embed tag, pointing at the built widget. */
const BUILT_WIDGET_TAG =
  '<script src="/dist-widget/iris-widget.js" defer data-api-base="/api"></script>';

/**
 * Serves tests/fixtures/<name>.html at /pages/<name>.html with the widget from source,
 * at /widget/<name>.html with the built dist-widget/ (and serves that folder), and
 * unchanged at /plain/<name>.html (for the extension's tests).
 */
function fixturePages(): Plugin {
  const dir = join(import.meta.dirname, 'tests', 'fixtures');
  return {
    name: 'iris-fixture-pages',
    apply: 'serve',
    configureServer(server) {
      const built = join(import.meta.dirname, 'dist-widget');
      server.middlewares.use('/dist-widget/', (req, res, next) => {
        const file = (req.url ?? '').split('?')[0]?.replace(/^\//, '') ?? '';
        if (!/^[a-z0-9-]+(\/[a-z0-9-]+)?\.(js|woff2)$/.test(file)) {
          next();
          return;
        }
        readFile(join(built, file)).then(
          (data) => {
            res.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : 'font/woff2');
            res.end(data);
          },
          () => {
            next();
          },
        );
      });
      server.middlewares.use((req, res, next) => {
        const match = /^\/(pages|plain|widget)\/([a-z-]+\.html)(\?.*)?$/.exec(req.url ?? '');
        const [, kind, file] = match ?? [];
        if (!kind || !file) {
          next();
          return;
        }
        readFile(join(dir, file), 'utf8')
          .then((html) =>
            kind === 'plain'
              ? html
              : kind === 'widget'
                ? html.replace('</body>', `${BUILT_WIDGET_TAG}</body>`)
                : server.transformIndexHtml(
                    `/pages/${file}`,
                    html.replace(
                      '</body>',
                      '<script type="module" src="/page-embed.tsx"></script></body>',
                    ),
                  ),
          )
          .then(
            (html) => {
              res.setHeader('Content-Type', 'text/html');
              res.end(html);
            },
            () => {
              next();
            },
          );
      });
    },
  };
}

/**
 * The widget's dev harness: http://localhost:5173, with /api proxied to the
 * backend on port 8000. The production widget build is scripts/build-widget.ts.
 */
export default defineConfig({
  root: 'harness',
  plugins: [preact(), devWorklet(), devFonts(), fixturePages()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: { '/api': 'http://localhost:8000' },
    fs: { allow: ['..'] },
    // A non-local name the browser tests map to 127.0.0.1, so the automatic site check
    // doesn't skip the page as local.
    allowedHosts: ['iris-login.test'],
  },
});
