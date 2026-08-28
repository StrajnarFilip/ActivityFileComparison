/**
 * Minimal static file server for local development.
 *
 * The app is plain static files, but it is built from ES modules, so it has to
 * be served over http:// rather than opened from the file system.
 *
 *   node tools/serve.mjs [port]
 */

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** @type {Record<string, string>} */
const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.gpx': 'application/gpx+xml',
  '.tcx': 'application/vnd.garmin.tcx+xml',
};

/**
 * @param {number} port
 * @returns {Promise<import('node:http').Server>}
 */
export function serve(port) {
  const server = createServer(async (request, response) => {
    // Strip the query string and any attempt to climb out of the project.
    const requested = normalize(decodeURIComponent((request.url ?? '/').split('?')[0]));
    const path = join(ROOT, requested === '/' ? 'index.html' : requested);

    if (!path.startsWith(ROOT)) {
      response.writeHead(403).end('forbidden');
      return;
    }

    try {
      const body = await readFile(path);
      response.writeHead(200, {
        'content-type': CONTENT_TYPES[extname(path)] ?? 'application/octet-stream',
        'cache-control': 'no-store',
      });
      response.end(body);
    } catch {
      response.writeHead(404).end('not found');
    }
  });

  return new Promise((resolve) => server.listen(port, () => resolve(server)));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.argv[2] ?? 8080);
  await serve(port);
  console.log(`serving ${ROOT} on http://localhost:${port}/`);
}
