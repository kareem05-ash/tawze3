/** Release version shown in Settings. Comes from the build-time env var VITE_APP_VERSION (set by CI from the Git tag), never hardcoded. */
const SEMVER = /^v?(\d{1,4}\.\d{1,3}\.\d{1,3})$/;

/** "0.1.3" or "v0.1.3" -> "v0.1.3"; anything else (unset, empty, malformed) -> null, so the UI falls back to the development label. */
export function releaseLabel(raw: string | undefined): string | null {
  const m = SEMVER.exec((raw ?? '').trim());
  return m ? `v${m[1]}` : null;
}
/** Label of the running build, or null for development / pull-request builds. */
export const appVersionLabel = () => releaseLabel(import.meta.env.VITE_APP_VERSION);
