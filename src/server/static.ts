import { existsSync, readFileSync, statSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { extname, join, normalize } from 'node:path';
import { gzipSync } from 'node:zlib';

/**
 * The built client (dist/), served from memory with HTTP caching and compression:
 *
 * - `/assets/*` (Vite's content-hashed bundles) are immutable: cached for a year, never revalidated.
 *   Everything else (index.html, textures, HDRIs) carries an ETag and revalidates (`no-cache` for the
 *   page, an hour for the rest), answering 304 when unchanged.
 * - Text (JS, CSS, HTML, SVG, JSON, Markdown, HDR images) goes out Brotli- or gzip-compressed: the `.br` /
 *   `.gz` files the build writes next to each one (vite.config.ts), else gzip made once here and kept.
 * - Files are read once and kept in memory, keyed by size and mtime (a rebuild is picked up on the next
 *   request: the stat is cheap).
 */
const MIME: Record<string, string> = { '.webp': 'image/webp', '.hdr': 'application/octet-stream', '.md': 'text/markdown; charset=utf-8', '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.json': 'application/json', '.ico': 'image/x-icon', '.ktx2': 'image/ktx2', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8', '.webmanifest': 'application/manifest+json' };
const COMPRESSIBLE = new Set(['.js', '.css', '.html', '.svg', '.json', '.md', '.hdr', '.txt', '.webmanifest']);

interface Entry { tag: string; body: Buffer; br: Buffer | null; gz: Buffer | null }
const cache = new Map<string, Entry>();

function entry(file: string): Entry {
  const st = statSync(file);
  const tag = `"${st.size.toString(36)}-${Math.floor(st.mtimeMs).toString(36)}"`;
  const hit = cache.get(file);
  if (hit?.tag === tag) return hit;
  const body = readFileSync(file);
  const side = (ext: string) => { try { const s = statSync(file + ext); return s.mtimeMs >= st.mtimeMs ? readFileSync(file + ext) : null; } catch { return null; } };
  let br: Buffer | null = null, gz: Buffer | null = null;
  if (COMPRESSIBLE.has(extname(file)) && body.length > 1024) {
    br = side('.br');
    gz = side('.gz') ?? gzipSync(body, { level: 6 });
    if (gz.length >= body.length) gz = null;
    if (br && br.length >= body.length) br = null;
  }
  const e = { tag, body, br, gz };
  cache.set(file, e);
  return e;
}

/** Serve `path` from `dist`, falling back to index.html (the client routes nothing itself, but old links land there). */
export function serveStatic(dist: string, req: IncomingMessage, res: ServerResponse, path: string) {
  if (!existsSync(dist)) {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end('<h1>Hogwarts server is running</h1><p>No client build found. Run <code>npm run build</code>, or use <code>npm run dev</code> and open the Vite URL.</p><p>MCP endpoint: <code>/mcp</code></p>');
    return;
  }
  let file = normalize(join(dist, path === '/' ? 'index.html' : path));
  let fallback = false;
  if (!file.startsWith(dist) || !existsSync(file) || statSync(file).isDirectory()) { file = join(dist, 'index.html'); fallback = true; }
  const e = entry(file);
  const ext = extname(file);
  const headers: Record<string, string> = {
    'content-type': MIME[ext] ?? 'application/octet-stream',
    'cache-control': !fallback && path.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : ext === '.html' ? 'no-cache' : 'public, max-age=3600',
    etag: e.tag,
  };
  if (e.br || e.gz) headers.vary = 'accept-encoding';
  if (req.headers['if-none-match'] === e.tag) { res.writeHead(304, headers); res.end(); return; }
  const accept = String(req.headers['accept-encoding'] ?? '');
  let body = e.body;
  if (e.br && /\bbr\b/.test(accept)) { body = e.br; headers['content-encoding'] = 'br'; }
  else if (e.gz && /\bgzip\b/.test(accept)) { body = e.gz; headers['content-encoding'] = 'gzip'; }
  headers['content-length'] = String(body.length);
  res.writeHead(200, headers);
  res.end(req.method === 'HEAD' ? undefined : body);
}
