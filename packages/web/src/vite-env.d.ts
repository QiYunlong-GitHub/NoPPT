/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_APP_TITLE: string;
  readonly VITE_API_BASE_URL: string;
  readonly VITE_USE_MOCK: string;
  readonly VITE_NOPPT_API_KEY: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
