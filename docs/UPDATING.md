# Updating the app without losing data

**What keeps the data:** the Android database lives in the app's private storage and is tied to the applicationId (`com.tawze3.app`) and the signing key. A new APK with the same id and key installs OVER the old app and the data stays.

**Never:** uninstall first, change `applicationId`, or sign with a different key.

## Steps for a developer
1. Make the change, run `npm test`, `npm run typecheck`.
2. If the database changes: add a NEW migration file `src/db/migrations/00N_name.sql` and register it in `src/db/migrations/index.ts`. Never edit or reorder a released migration. Write a test like the ones in `tests/db.test.ts` that upgrades a database containing data.
3. Do not edit the version by hand: it comes from the Git tag you push (`docs/RELEASING.md`). Local Gradle builds without version properties are development builds (`0.0.0-dev`, versionCode 1) and cannot be installed over a released APK.
4. `npm run android:sync`, `npm run android:release`.
5. Before sending the APK to the owner, ask the owner to make a backup (Backup page) and keep it.
6. Install over the old app (`adb install -r` or open the APK). Check that old invoices are still there.

The app refuses to open a database that is NEWER than the app (e.g. after installing an older APK), so data is never silently damaged by a downgrade.
