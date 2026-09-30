// Serves dist/ the way Caddy does (directory index, then the .html file) and forwards /api
// to the backend on port 8000. Used by the tests and `pnpm preview`.
import { readFile } from 'node:fs/promises';
import { createServer, request } from 'node:http';
import { join } from 'node:path';
import sirv from 'sirv';

const PORT = Number(process.env.PORT ?? 4322);
const BACKEND = { host: '127.0.0.1', port: 8000 };
const DIST = join(import.meta.dirname, '..', 'dist');
const serve = sirv(DIST, {
  extensions: ['html'],
  dev: true,
});

/** The site's own 404 page, with a 404 status (as Caddy's handle_errors does). */
async function notFound(res) {
  const page = await readFile(join(DIST, '404.html')).catch(() => Buffer.from('Not found'));
  res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(page);
}

createServer((req, res) => {
  if (req.url?.startsWith('/api/')) {
    const upstream = request(
      { ...BACKEND, path: req.url, method: req.method, headers: req.headers },
      (answer) => {
        res.writeHead(answer.statusCode ?? 502, answer.headers);
        answer.pipe(res);
      },
    );
    upstream.on('error', () => {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end('{"error":{"code":"upstream_error","message":"Backend unreachable"}}');
    });
    req.pipe(upstream);
    return;
  }
  serve(req, res, () => {
    void notFound(res);
  });
}).listen(PORT, () => {
  console.log(`Demo site on http://localhost:${String(PORT)} (API → :8000)`);
});
