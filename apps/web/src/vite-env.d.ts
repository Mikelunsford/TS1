/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_SUPABASE_ANON_KEY: string;
  readonly VITE_APP_NAME: string;
  readonly VITE_DEFAULT_TENANT_BRAND: string;
  readonly VITE_BASE_DOMAIN: string;
  readonly VITE_API_BASE_URL: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

// Deno URL imports referenced from supabase/functions/_shared/types.ts.
// At runtime the contract test rewrites these to bare 'zod' (see
// apps/web/vitest.contract.config.ts). For tsc, alias them to the same
// module via global declarations so the parity test can typecheck.
declare module 'https://esm.sh/zod@3.23.8' {
  export * from 'zod';
}
