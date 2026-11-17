/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Opsional. Aktifkan sinkron goal lintas perangkat dengan Supabase. */
  readonly VITE_SUPABASE_URL?: string;
  /** Kunci anon/publishable Supabase (publik by design; keamanan data lewat Row Level Security). */
  readonly VITE_SUPABASE_ANON_KEY?: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
