import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
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

export default defineConfig({
  root: 'client',
  build: { outDir: OUT, emptyOutDir: true, chunkSizeWarningLimit: 1200 },
  plugins: [precompress()],
  server: {
    port: 5173,
    proxy: {
      '/api': target,
      '/mcp': target,
      '/ws': { target: target.replace('http', 'ws'), ws: true },
    },
  },
});
