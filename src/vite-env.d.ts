/// <reference types="vite/client" />
interface ImportMetaEnv {
  /** Release version without the leading "v" (e.g. "0.1.3"). Set by CI from the Git tag; absent in dev and pull-request builds. */
  readonly VITE_APP_VERSION?: string;
}
interface ImportMeta { readonly env: ImportMetaEnv }
