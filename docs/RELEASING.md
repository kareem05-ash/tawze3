# Releasing

The Git tag is the single source of truth for the app version. There is no version to edit in source files.

## Release steps
With a clean `main` that is pushed and green:
```bash
git tag -a v0.1.3 -m "Tawze3 v0.1.3"
git push origin v0.1.3
```
GitHub Actions (`.github/workflows/tawze3.yml`) then:
1. Validates the tag (a malformed `v*` tag fails the run immediately, before anything is built).
2. Runs typecheck, tests, web build, `cap sync`, and the Gradle build with the derived version.
3. Checks the built APK with `aapt2`: application id `com.tawze3.app`, `versionName` and `versionCode` must equal the expected values.
4. Uploads `tawze3-v0.1.3.apk` as the run artifact, and publishes a GitHub Release with that same file.
   It refuses to touch a release that already exists.

Branch and pull-request builds do not need a tag: they build `tawze3-dev.apk` (version `0.0.0-dev`, versionCode 1) and upload it as an artifact only.

## Supported version format
`vMAJOR.MINOR.PATCH`: decimal integers, no leading zeros, no suffix (`v1.0.0-rc1` is rejected).

| Part  | Range     |
|-------|-----------|
| MAJOR | 0 .. 2099 |
| MINOR | 0 .. 999  |
| PATCH | 0 .. 999  |

`v0.0.0` is rejected (it would give versionCode 0). Anything else is rejected with an explicit error, in CI (`scripts/version.mjs`) and again in Gradle.

## versionCode
```
versionCode = MAJOR * 1,000,000 + MINOR * 1,000 + PATCH
```
Examples: `v0.1.2` -> 1002, `v0.1.3` -> 1003, `v1.0.0` -> 1000000, largest `v2099.999.999` -> 2099999999 (Android's limit is 2,100,000,000).

Why it always increases: MINOR and PATCH are always below 1000, so the code is a base-1000 positional number. Comparing two versions by (MAJOR, MINOR, PATCH) gives the same answer as comparing their codes. `tests/version.test.ts` also checks this over every boundary combination.
Builds made before this scheme used versionCode 1, so every release (>= 1002 for 0.1.2) updates over them.

## Where the version goes
| Place | Value |
|-------|-------|
| `VITE_APP_VERSION` (build env for Vite) | `0.1.3`; shown in Settings as `v0.1.3`; empty in dev builds, which show "نسخة تطوير" |
| `versionName` / `versionCode` (Gradle `-PappVersionName`, `-PappVersionCode`, or env `APP_VERSION_NAME`, `APP_VERSION_CODE`) | `0.1.3` / `1003` |
| APK file name | `tawze3-v0.1.3.apk` |

Gradle fails if only one of the two properties is given, if either is malformed or out of range, or if the code does not match the name.

## Limitations
- `package.json` still says `"version": "1.0.0"`. It is not used by the app or the build, so it was left alone instead of being kept in sync.
- The version only exists in the tag. A local `npm run build` shows the development label unless you set `VITE_APP_VERSION=0.1.3` yourself.
- The mapping holds only for the format above. Supporting pre-release suffixes or larger numbers would need a new mapping that keeps ordering.
- Do not move or delete a pushed tag. Releases are immutable by design: publish a new patch version instead.
- A development APK (versionCode 1) cannot be installed over a release APK (Android refuses downgrades).
