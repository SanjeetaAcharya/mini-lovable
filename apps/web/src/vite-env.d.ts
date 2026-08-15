/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * Origin of the deployed API, e.g. "https://mini-lovable-api.onrender.com"
   * — no trailing slash, no "/api" suffix. Left unset in local dev, where
   * requests to "/api/..." are relative and handled by the Vite dev
   * server's proxy (see vite.config.ts) straight to localhost:4000.
   */
  readonly VITE_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
