import { Capacitor } from '@capacitor/core';
import type { Db } from '../db/types';
import { setSetting } from '../services/settings';
import { one } from '../services/common';

/**
 * Optional fingerprint/face unlock (Android app only). It is a convenience on top of the PIN, never a replacement:
 * the PIN always works, and removing the PIN also removes this (the key starts with `pin_`, so it is never backed up).
 * Note: a successful biometric unlock bypasses the PIN attempt limiter, which is the normal behaviour of biometric unlock.
 */
export const BIOMETRIC_KEY = 'pin_biometric';

export async function biometricAvailable(): Promise<boolean> {
  if (!Capacitor.isNativePlatform()) return false;
  try { const { BiometricAuth } = await import('@aparajita/capacitor-biometric-auth'); return (await BiometricAuth.checkBiometry()).isAvailable; } catch { return false; }
}
export async function biometricEnabled(db: Db): Promise<boolean> {
  return (await one<{ value: string }>(db, 'SELECT value FROM settings WHERE key = ?', [BIOMETRIC_KEY]))?.value === 'on';
}
export const setBiometricEnabled = (db: Db, on: boolean) => setSetting(db, BIOMETRIC_KEY, on ? 'on' : 'off');

/** Shows the system biometric prompt. Returns true on success, false on cancel/failure (the caller falls back to the PIN). */
export async function biometricUnlock(reason: string, cancelTitle: string): Promise<boolean> {
  try {
    const { BiometricAuth } = await import('@aparajita/capacitor-biometric-auth');
    await BiometricAuth.authenticate({ reason, cancelTitle, allowDeviceCredential: false, androidTitle: reason });
    return true;
  } catch { return false; }
}
