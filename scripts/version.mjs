#!/usr/bin/env node
// Single source of truth for release versioning (Git tag -> app version -> Android versionName/versionCode).
// Used by the GitHub Actions workflow (CLI below) and by tests/version.test.ts. Documented in docs/RELEASING.md.
//
// Supported tag format (strict):  v<MAJOR>.<MINOR>.<PATCH>
//   - plain decimal integers, no leading zeros ("v01.2.3" is rejected), no pre-release/build suffix ("v1.0.0-rc1" is rejected)
//   - MAJOR 0..2099, MINOR 0..999, PATCH 0..999, and the version must not be 0.0.0
// Android versionCode = MAJOR * 1_000_000 + MINOR * 1_000 + PATCH
//   Positional base-1000 encoding: because MINOR and PATCH are always < 1000, comparing two versions component by component
//   (major, then minor, then patch) gives exactly the same result as comparing their codes, so the mapping is strictly increasing.
//   Largest code = 2099 * 1_000_000 + 999 * 1_000 + 999 = 2_099_999_999 <= 2_100_000_000 (Android's maximum).

export const MAX_ANDROID_VERSION_CODE = 2_100_000_000;
export const LIMITS = Object.freeze({ major: 2099, minor: 999, patch: 999 });
export const DEV_VERSION_NAME = '0.0.0-dev';
export const DEV_VERSION_CODE = 1;

const TAG_RE = /^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/;

/** Parses a release tag such as "v0.1.3". Throws an Error with a clear message when it is malformed or out of range. */
export function parseReleaseTag(tag) {
  if (typeof tag !== 'string' || tag.length === 0) throw new Error('Release tag is empty.');
  const m = TAG_RE.exec(tag);
  if (!m) throw new Error(`Invalid release tag "${tag}". Expected v<MAJOR>.<MINOR>.<PATCH>, e.g. v0.1.3 (digits only, no leading zeros, no suffix).`);
  // Reject by length before Number() so absurdly long digit strings are never parsed.
  if (m.slice(1).some(p => p.length > 4)) throw new Error(`Invalid release tag "${tag}": a component is out of range (max ${LIMITS.major}.${LIMITS.minor}.${LIMITS.patch}).`);
  const [major, minor, patch] = m.slice(1).map(Number);
  if (major > LIMITS.major) throw new Error(`Invalid release tag "${tag}": MAJOR ${major} exceeds ${LIMITS.major}.`);
  if (minor > LIMITS.minor) throw new Error(`Invalid release tag "${tag}": MINOR ${minor} exceeds ${LIMITS.minor}.`);
  if (patch > LIMITS.patch) throw new Error(`Invalid release tag "${tag}": PATCH ${patch} exceeds ${LIMITS.patch}.`);
  if (major === 0 && minor === 0 && patch === 0) throw new Error(`Invalid release tag "${tag}": v0.0.0 would give versionCode 0, which Android rejects.`);
  const versionName = `${major}.${minor}.${patch}`;
  return { tag, versionName, major, minor, patch, versionCode: versionCodeOf(major, minor, patch) };
}

/** The mapping itself; validates its inputs again so it can be used on its own. */
export function versionCodeOf(major, minor, patch) {
  for (const [n, v, max] of [['major', major, LIMITS.major], ['minor', minor, LIMITS.minor], ['patch', patch, LIMITS.patch]]) {
    if (!Number.isInteger(v) || v < 0 || v > max) throw new Error(`${n} must be an integer in 0..${max}, got ${v}.`);
  }
  const code = major * 1_000_000 + minor * 1_000 + patch;
  if (code < 1) throw new Error('versionCode must be positive (0.0.0 is not a valid release).');
  if (code > MAX_ANDROID_VERSION_CODE) throw new Error(`versionCode ${code} exceeds Android's maximum ${MAX_ANDROID_VERSION_CODE}.`);
  return code;
}

/**
 * Resolves what to build. With a tag: strict parse (throws on anything invalid).
 * Without one (development, pull request, ordinary branch push): a safe development fallback that never looks like a release.
 */
export function resolveBuildVersion(tag) {
  if (tag === undefined || tag === null || tag === '') {
    return { release: false, tag: '', versionName: DEV_VERSION_NAME, versionCode: DEV_VERSION_CODE, label: 'dev', viteVersion: '' };
  }
  const p = parseReleaseTag(tag);
  return { release: true, tag: p.tag, versionName: p.versionName, versionCode: p.versionCode, label: `v${p.versionName}`, viteVersion: p.versionName };
}

// ---- CLI: `node scripts/version.mjs [tag]`; prints KEY=value lines (usable with >> "$GITHUB_OUTPUT") and exits 1 with a message on bad input.
const isMain = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1].replace(/\\/g, '/')}`).href;
if (isMain) {
  try {
    const r = resolveBuildVersion(process.argv[2]);
    console.log(`release=${r.release}\nversion_name=${r.versionName}\nversion_code=${r.versionCode}\nvite_version=${r.viteVersion}\nlabel=${r.label}\napk_name=tawze3-${r.label}.apk`);
  } catch (e) {
    console.error(`::error::${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  }
}
