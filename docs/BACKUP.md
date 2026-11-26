# Backup and restore

- **Manual backup** (Backup page): downloads/shares a `.json` file with all records and settings (not the PIN), the schema version and a SHA-256 integrity checksum.
  Optional passphrase: AES-256-GCM encryption (PBKDF2-SHA256, 250,000 iterations). **A forgotten passphrase cannot be recovered.**
- **Automatic daily backup**: once per day when the app is opened (also on resume and hourly while open); the last 7 are kept inside the app. Android does not guarantee background execution when the app is closed, so a day is only covered if the app was opened that day. These copies stay on the phone and do NOT protect against losing the phone.
- **Restore**: the file is validated first (format, checksum, schema version, known tables/columns). A safety copy of the current data is handed over BEFORE anything changes; the replacement is one transaction, so a failure leaves the data untouched. Backups from older schema versions restore into the current schema. The current PIN is kept.
- **Recommended routine:** export a backup weekly to a computer / private cloud / "WhatsApp to myself", and before every app update.
- Not promised: automatic WhatsApp or cloud upload (no authorised integration exists).
