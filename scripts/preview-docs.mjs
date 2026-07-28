#!/usr/bin/env node
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const DEFAULT_BASE_PATH = '/emap/';
const CONTENT_TYPES = new Map([
  ['.arrow', 'application/vnd.apache.arrow.file'],
  ['.css', 'text/css; charset=utf-8'],
  ['.feather', 'application/vnd.apache.arrow.file'],
  ['.geojson', 'application/geo+json; charset=utf-8'],
  ['.gif', 'image/gif'],
  ['.html', 'text/html; charset=utf-8'],
  ['.ico', 'image/x-icon'],
  ['.jpeg', 'image/jpeg'],
  ['.jpg', 'image/jpeg'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.mjs', 'text/javascript; charset=utf-8'],
  ['.parquet', 'application/octet-stream'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml; charset=utf-8'],
  ['.topojson', 'application/json; charset=utf-8'],
  ['.wasm', 'application/wasm'],
  ['.webp', 'image/webp'],
  ['.woff', 'font/woff'],
  ['.woff2', 'font/woff2'],
  ['.xml', 'application/xml; charset=utf-8'],
  ['.zip', 'application/zip'],
]);

export function createDocsPreviewHandler(options = {}) {
  const buildDir = resolve(
    options.buildDir ?? resolve(options.root ?? process.cwd(), 'packages/docs/build'),
  );
  const basePath = options.basePath ?? DEFAULT_BASE_PATH;
  const readPreviewFile = options.fileSystem?.readFile ?? readFile;
  const statPreviewFile = options.fileSystem?.stat ?? stat;

  return async function handleDocsPreview(request, response) {
    const method = request.method ?? 'GET';
    if (method !== 'GET' && method !== 'HEAD') {
      response.setHeader('allow', 'GET, HEAD');
      sendError(response, method, 405, 'Method Not Allowed');
      return;
    }

    try {
      const resolution = await resolveRequestPath(
        request.url ?? '/',
        buildDir,
        basePath,
        statPreviewFile,
      );
      if (!resolution.file) {
        sendError(response, method, resolution.status, resolution.message);
        return;
      }

      const content = await readPreviewFile(resolution.file);
      response.statusCode = 200;
      response.setHeader(
        'content-type',
        CONTENT_TYPES.get(extname(resolution.file).toLowerCase()) ?? 'application/octet-stream',
      );
      response.setHeader('content-length', content.byteLength);
      response.setHeader('x-content-type-options', 'nosniff');
      response.end(method === 'HEAD' ? undefined : content);
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'unknown filesystem error';
      sendError(response, method, 500, `Unable to serve preview request: ${detail}`);
    }
  };
}

async function resolveRequestPath(requestUrl, buildDir, basePath, statPreviewFile) {
  const rawPath = requestUrl.split(/[?#]/, 1)[0];
  let pathname;

  try {
    pathname = decodeURIComponent(rawPath);
  } catch {
    return { status: 400, message: 'Bad Request' };
  }

  if (pathname.includes('\0')) return { status: 400, message: 'Bad Request' };
  if (pathname.split(/[\\/]+/).includes('..')) {
    return { status: 403, message: 'Forbidden' };
  }
  if (!pathname.startsWith(basePath)) {
    return { status: 404, message: 'Not Found' };
  }

  const requested = resolve(buildDir, pathname.slice(basePath.length));
  if (!isWithin(buildDir, requested)) return { status: 403, message: 'Forbidden' };

  const requestedStat = await statOrNull(requested, statPreviewFile);
  if (requestedStat?.isFile()) return { status: 200, file: requested };

  if (requestedStat?.isDirectory()) {
    const indexFile = resolve(requested, 'index.html');
    if ((await statOrNull(indexFile, statPreviewFile))?.isFile()) {
      return { status: 200, file: indexFile };
    }
  }

  if (extname(pathname) === '') {
    const spaEntry = resolve(buildDir, 'index.html');
    if ((await statOrNull(spaEntry, statPreviewFile))?.isFile()) {
      return { status: 200, file: spaEntry };
    }
  }

  return { status: 404, message: 'Not Found' };
}

async function statOrNull(path, statPreviewFile) {
  try {
    return await statPreviewFile(path);
  } catch (error) {
    if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') return null;
    throw error;
  }
}

function sendError(response, method, status, message) {
  response.statusCode = status;
  response.setHeader('content-type', 'text/plain; charset=utf-8');
  response.end(method === 'HEAD' ? undefined : message);
}

function isWithin(root, candidate) {
  const path = relative(root, candidate);
  return path === '' || (!path.startsWith('..') && !path.startsWith('/'));
}

function readOption(argv, name, fallback) {
  const index = argv.indexOf(name);
  return index === -1 ? fallback : argv[index + 1];
}

async function startDocsPreview() {
  const host = readOption(process.argv.slice(2), '--host', process.env.HOST ?? '127.0.0.1');
  const portValue = readOption(process.argv.slice(2), '--port', process.env.PORT ?? '3000');
  const port = Number(portValue);
  if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    throw new Error(`Invalid preview port: ${portValue}`);
  }

  const server = createServer(createDocsPreviewHandler());
  server.listen(port, host, () => {
    const address = server.address();
    const listeningPort = typeof address === 'object' && address ? address.port : port;
    console.log(`Documentation preview: http://${host}:${listeningPort}${DEFAULT_BASE_PATH}`);
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await startDocsPreview();
}
