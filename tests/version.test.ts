import { execFileSync, spawnSync } from 'node:child_process';
import { describe, it, expect } from 'vitest';
import { DEV_VERSION_CODE, DEV_VERSION_NAME, LIMITS, MAX_ANDROID_VERSION_CODE, parseReleaseTag, resolveBuildVersion, versionCodeOf } from '../scripts/version.mjs';
import { releaseLabel } from '../src/version';

describe('release tag -> version name', () => {
  it('v0.1.2 -> 0.1.2 and v0.1.3 -> 0.1.3', () => {
    expect(parseReleaseTag('v0.1.2')).toMatchObject({ versionName: '0.1.2', versionCode: 1002 });
    expect(parseReleaseTag('v0.1.3')).toMatchObject({ versionName: '0.1.3', versionCode: 1003 });
  });
  it.each(['', '0.1.3', 'v0.1', 'v0.1.3.4', 'v01.2.3', 'v1.02.3', 'v1.2.03', 'v1.0.0-rc1', 'v1.0.0+5', 'V1.0.0', 'vfoo', ' v1.0.0', 'v1.0.0 ', 'v-1.0.0', 'v1.0.x', 'v1..0'])('rejects malformed tag %j', t => {
    expect(() => parseReleaseTag(t)).toThrow();
  });
  it('rejects non-strings', () => { expect(() => parseReleaseTag(undefined as unknown as string)).toThrow(); });
  it('rejects v0.0.0 (versionCode would be 0)', () => { expect(() => parseReleaseTag('v0.0.0')).toThrow(/0\.0\.0/); });
});

describe('numeric limits', () => {
  it('accepts the largest supported version and it stays within Android\'s maximum', () => {
    const p = parseReleaseTag(`v${LIMITS.major}.${LIMITS.minor}.${LIMITS.patch}`);
    expect(p.versionCode).toBe(2_099_999_999);
    expect(p.versionCode).toBeLessThanOrEqual(MAX_ANDROID_VERSION_CODE);
  });
  it('rejects every component above its limit, including absurdly long numbers', () => {
    expect(() => parseReleaseTag('v2100.0.0')).toThrow(/MAJOR/);
    expect(() => parseReleaseTag('v0.1000.0')).toThrow(/MINOR/);
    expect(() => parseReleaseTag('v0.0.1000')).toThrow(/PATCH/);
    expect(() => parseReleaseTag('v99999999999999999999.0.0')).toThrow();
  });
  it('versionCodeOf enforces the limits and the Android maximum on its own', () => {
    expect(() => versionCodeOf(2100, 0, 0)).toThrow();
    expect(() => versionCodeOf(0, 1000, 0)).toThrow();
    expect(() => versionCodeOf(0, 0, -1)).toThrow();
    expect(() => versionCodeOf(1.5, 0, 0)).toThrow();
    expect(() => versionCodeOf(0, 0, 0)).toThrow();
    expect(versionCodeOf(0, 0, 1)).toBe(1);
  });
});

describe('versionCode ordering', () => {
  const cmp = (a: number[], b: number[]) => a[0]! - b[0]! || a[1]! - b[1]! || a[2]! - b[2]!;
  it('sequential releases strictly increase', () => {
    const seq = ['v0.1.2', 'v0.1.3', 'v0.1.4', 'v0.2.0', 'v0.10.0', 'v0.999.999', 'v1.0.0', 'v1.0.1', 'v1.1.0', 'v2.0.0', 'v2099.999.999'].map(t => parseReleaseTag(t).versionCode);
    for (let i = 1; i < seq.length; i++) expect(seq[i]!).toBeGreaterThan(seq[i - 1]!);
  });
  it('code order equals (major, minor, patch) order on every boundary combination', () => {
    const vals = [0, 1, 2, 9, 10, 99, 100, 998, 999];
    const all: number[][] = [];
    for (const a of [0, 1, 2, 10, 2098, 2099]) for (const b of vals) for (const c of vals) if (a + b + c > 0) all.push([a, b, c]);
    for (const x of all) for (const y of all) {
      const d = cmp(x, y), cx = versionCodeOf(x[0]!, x[1]!, x[2]!), cy = versionCodeOf(y[0]!, y[1]!, y[2]!);
      expect(Math.sign(cx - cy)).toBe(Math.sign(d));
    }
  });
  it('is above the legacy code 1 used by builds that predate tag-driven versioning', () => { expect(parseReleaseTag('v0.1.2').versionCode).toBeGreaterThan(1); });
});

describe('development builds', () => {
  it('work without a tag: safe fallback, no VITE_APP_VERSION, never a release', () => {
    for (const none of [undefined, null, '']) {
      expect(resolveBuildVersion(none)).toEqual({ release: false, tag: '', versionName: DEV_VERSION_NAME, versionCode: DEV_VERSION_CODE, label: 'dev', viteVersion: '' });
    }
  });
  it('a tag build exposes the version without the v for Vite and with it for the APK name', () => {
    expect(resolveBuildVersion('v0.1.3')).toMatchObject({ release: true, versionName: '0.1.3', versionCode: 1003, viteVersion: '0.1.3', label: 'v0.1.3' });
  });
  it('the settings label falls back to null (development label) when unset or malformed', () => {
    expect(releaseLabel(undefined)).toBeNull(); expect(releaseLabel('')).toBeNull(); expect(releaseLabel('banana')).toBeNull();
    expect(releaseLabel('0.1.3')).toBe('v0.1.3'); expect(releaseLabel('v0.1.3')).toBe('v0.1.3');
  });
});

describe('CLI used by the workflow', () => {
  it('prints outputs for a valid tag and for no tag', () => {
    const out = execFileSync('node', ['scripts/version.mjs', 'v0.1.3'], { encoding: 'utf8' });
    expect(out).toContain('version_name=0.1.3'); expect(out).toContain('version_code=1003'); expect(out).toContain('apk_name=tawze3-v0.1.3.apk');
    expect(execFileSync('node', ['scripts/version.mjs'], { encoding: 'utf8' })).toContain('apk_name=tawze3-dev.apk');
  });
  it('exits non-zero with an error for a malformed tag', () => {
    const r = spawnSync('node', ['scripts/version.mjs', 'v1.0'], { encoding: 'utf8' });
    expect(r.status).toBe(1); expect(r.stderr).toContain('Invalid release tag');
  });
});

import { readFileSync } from 'node:fs';
describe('workflow wiring (static checks of .github/workflows/tawze3.yml)', () => {
  const wf = readFileSync('.github/workflows/tawze3.yml', 'utf8');
  it('derives the version via scripts/version.mjs before building, and feeds Vite and Gradle from its outputs', () => {
    expect(wf.indexOf('scripts/version.mjs')).toBeGreaterThan(-1);
    expect(wf.indexOf('scripts/version.mjs')).toBeLessThan(wf.indexOf('npm ci'));
    expect(wf).toContain('VITE_APP_VERSION: ${{ steps.version.outputs.vite_version }}');
    expect(wf).toContain('-PappVersionName="${{ steps.version.outputs.version_name }}"');
    expect(wf).toContain('-PappVersionCode="${{ steps.version.outputs.version_code }}"');
  });
  it('keeps every existing check and only releases valid v* tags from the same run', () => {
    for (const s of ['npm run typecheck', 'npm test', 'npm run build', 'npx cap sync android', 'cache: npm', 'node-version: 24', 'java-version: 21', 'upload-artifact', "startsWith(github.ref, 'refs/tags/v')", 'download-artifact']) expect(wf).toContain(s);
  });
});
