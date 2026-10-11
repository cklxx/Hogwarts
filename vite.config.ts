import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { extname, join, relative, resolve } from 'node:path';
import { brotliCompressSync, constants, gzipSync } from 'node:zlib';
import { defineConfig, type Plugin } from 'vite';

const target = `http://localhost:${process.env.PORT ?? 7777}`;
const OUT = resolve(__dirname, 'dist');

/**
 * Writes `x.br` and `x.gz` next to every compressible file of the build, which the server sends to browsers
 * that accept them (src/server/static.ts): the bundle goes over the wire at a quarter of its size.
 */
function precompress(): Plugin {
  const TEXT = new Set(['.js', '.css', '.html', '.svg', '.json', '.md', '.hdr', '.txt']);
  const walk = (dir: string): string[] => readdirSync(dir).flatMap((f) => { const p = join(dir, f); return statSync(p).isDirectory() ? walk(p) : [p]; });
  return {
    name: 'hogwarts-precompress',
    apply: 'build',
    closeBundle() {
      for (const file of walk(OUT)) {
        if (!TEXT.has(extname(file))) continue;
        const body = readFileSync(file);
        if (body.length < 1024) continue;
        const gz = gzipSync(body, { level: 9 });
        if (gz.length < body.length) writeFileSync(file + '.gz', gz);
        // quality 11 is slow (~2 s/MB) but done once per build; the multi-MB HDRIs get 9
        const br = brotliCompressSync(body, { params: { [constants.BROTLI_PARAM_QUALITY]: body.length > 1_500_000 ? 9 : 11, [constants.BROTLI_PARAM_SIZE_HINT]: body.length } });
        if (br.length < body.length) writeFileSync(file + '.br', br);
      }
    },
  };
}

/**
 * 客户端热更新 (client/hot.ts): each feature of client/features.ts gets a chunk of its own, the libraries one (`vendor`)
 * and the rest of the client one (`shared`), so a feature that changed is a new file and nothing else is. `hot.json`
 * says which file each feature is now (and its factory's export), and `core`: a hash of everything that is not a
 * feature — the entry's code (with each feature's file name read as its key), the shared and vendor chunks, the CSS.
 * A new build with the same `core` swaps the changed features in the running page; any other reloads it.
 */
const CLIENT = resolve(__dirname, 'client');
const FEATURE_KEYS = new Set([...readFileSync(join(CLIENT, 'features.ts'), 'utf8').matchAll(/\['([\w/]+)', \w+\]/g)].map((m) => m[1]));
const featureKey = (id: string) => { const k = relative(CLIENT, id).replace(/\.ts$/, '').split('\\').join('/'); return FEATURE_KEYS.has(k) ? k : null; };
function featureChunks(): Plugin {
  return {
    name: 'hogwarts-feature-chunks',
    apply: 'build',
    enforce: 'post',
    generateBundle(_, bundle) {
      const feats: Record<string, { url: string; export: string; init?: string }> = {};
      const core = createHash('sha256');
      const files = Object.values(bundle);
      const named = new Map<string, string>(); // feature chunk file -> key
      for (const c of files) if (c.type === 'chunk') { const k = c.moduleIds.map(featureKey).find(Boolean); if (k && c.name.startsWith('feat-')) named.set(c.fileName, k); }
      for (const c of files.sort((a, b) => a.fileName.localeCompare(b.fileName))) {
        if (c.type === 'chunk') {
          const key = named.get(c.fileName);
          // (strictExecutionOrder wraps each module in a lazy init_*: a hot update calls it before reading the factory)
          if (key) { feats[key] = { url: `/${c.fileName}`, export: c.exports.find((e) => /Feature$/.test(e)) ?? 'default', init: c.exports.find((e) => e.startsWith('init_')) }; continue; }
          if (c.isEntry) { let code = c.code; for (const [f, k] of named) code = code.split(f.replace(/^assets\//, '')).join(`<${k}>`); core.update(code); }
          else core.update(c.fileName);
        } else if (c.fileName.endsWith('.css')) core.update(c.fileName);
      }
      const manifest = JSON.stringify({ core: core.digest('hex').slice(0, 16), feats });
      this.emitFile({ type: 'asset', fileName: 'hot.json', source: manifest });
      // and in the page itself: what this very page runs (a page loaded during a deploy must not read the next build's)
      const html = bundle['index.html'];
      if (html?.type === 'asset') html.source = String(html.source).replace('</head>', `<script type="application/json" id="hot-manifest">${manifest}</script></head>`);
    },
  };
}

export default defineConfig({
  root: 'client',
  build: {
    outDir: OUT, emptyOutDir: true, chunkSizeWarningLimit: 1200,
    rollupOptions: {
      input: {
        main: resolve(CLIENT, 'index.html'),
        '2d': resolve(CLIENT, '2d.html'),
      },
      output: {
        // export names kept: a hot update finds a feature's factory by name (hot.json)
        minifyInternalExports: false,
        strictExecutionOrder: true,
        codeSplitting: {
          includeDependenciesRecursively: false,
          groups: [
            { name: 'vendor', test: /node_modules/, priority: 30 },
            { name: (id: string) => `feat-${featureKey(id)!.replace('/', '-')}`, test: (id: string) => !!featureKey(id), priority: 20 },
            // (Vite's preload helper too: left in the entry's chunk, the shared chunk imported the entry's, and so every
            // feature's hash moved with any feature)
            { name: 'shared', test: (id: string) => { const rel = relative(CLIENT, id); return (!id.startsWith('\0') || id.includes('preload-helper')) && rel !== 'main.ts' && rel !== 'features.ts' && !rel.endsWith('.html'); }, priority: 10 },
          ],
        },
      },
    },
  },
  plugins: [featureChunks(), precompress()],
  server: {
    port: 5173,
    proxy: {
      '/api': target,
      '/mcp': target,
      '/ws': { target: target.replace('http', 'ws'), ws: true },
    },
  },
});
