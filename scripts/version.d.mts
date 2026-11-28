export const MAX_ANDROID_VERSION_CODE: number;
export const LIMITS: Readonly<{ major: number; minor: number; patch: number }>;
export const DEV_VERSION_NAME: string;
export const DEV_VERSION_CODE: number;
export interface ParsedTag { tag: string; versionName: string; major: number; minor: number; patch: number; versionCode: number }
export function parseReleaseTag(tag: string): ParsedTag;
export function versionCodeOf(major: number, minor: number, patch: number): number;
export interface BuildVersion { release: boolean; tag: string; versionName: string; versionCode: number; label: string; viteVersion: string }
export function resolveBuildVersion(tag?: string | null): BuildVersion;
