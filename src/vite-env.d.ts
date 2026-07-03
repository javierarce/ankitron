/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Set in the marketing demo build to run the app against an in-memory Anki mock. */
  readonly VITE_DEMO?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
