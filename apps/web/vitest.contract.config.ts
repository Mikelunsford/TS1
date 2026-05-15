import { defineConfig } from 'vitest/config';
import path from 'node:path';
import { readFileSync } from 'node:fs';

const sharedDir = path.resolve(__dirname, '../../supabase/functions/_shared');

/**
 * Contract tests verify the Zod canon is byte-mirrored between the SPA and
 * the Edge Function _shared modules. They run in Node (no jsdom).
 *
 * The _shared files use Deno-style URL imports (`https://esm.sh/zod@3.23.8`)
 * because they run in the Supabase Edge runtime. Vitest can't resolve those
 * in Node, so we rewrite them to bare `zod` at load time. The rewrite is
 * test-only; it does not touch the on-disk Deno file.
 */
const denoUrlImportRewrite = {
  name: 'deno-url-import-rewrite',
  enforce: 'pre' as const,
  resolveId(id: string) {
    if (id.startsWith('https://esm.sh/zod')) return 'zod';
    if (id.startsWith('https://esm.sh/@supabase/supabase-js')) return '@supabase/supabase-js';
    if (id.startsWith('https://deno.land/std')) {
      // std/http/server etc. — return a virtual stub since contract tests
      // don't exercise the HTTP layer.
      return '\0deno-std-stub';
    }
    return null;
  },
  load(id: string) {
    if (id === '\0deno-std-stub') {
      return 'export function serve() { throw new Error("deno std stub"); }';
    }
    return null;
  },
  transform(code: string, id: string) {
    if (!id.startsWith(sharedDir)) return null;
    // Rewrite any remaining inline URL imports we didn't catch in resolveId.
    return {
      code: code
        .replace(/from\s+['"]https:\/\/esm\.sh\/zod@[^'"]+['"]/g, "from 'zod'")
        .replace(
          /from\s+['"]https:\/\/esm\.sh\/@supabase\/supabase-js@[^'"]+['"]/g,
          "from '@supabase/supabase-js'",
        ),
      map: null,
    };
  },
};

// Silence unused-readFileSync warning in some toolchains.
void readFileSync;

export default defineConfig({
  plugins: [denoUrlImportRewrite],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@shared': sharedDir,
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['src/test/contract/**/*.test.ts'],
    exclude: ['node_modules', 'playwright'],
  },
});
