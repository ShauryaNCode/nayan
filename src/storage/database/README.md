# Path: OfflineFaceAuth/src/storage/database/README.md
# Purpose: Documents SQLCipher database architecture with schema design, encryption setup, passphrase derivation from hardware keystore.

## T3.1 SQLCipher + WAL Initialization

M3 owns the encrypted local database bootstrap. The database must be keyed before
any SQL statement is executed. With op-sqlite this is done by passing
`encryptionKey` to `open(...)`; op-sqlite applies the key through
`sqlite3_key_v2` immediately after `sqlite3_open_v2` and before returning the
connection.

The first JS-level statements on the connection are the WAL/concurrency PRAGMAs.
They run synchronously before migrations or application-level reads/writes:

```ts
db.executeSync('PRAGMA journal_mode=WAL;');
db.executeSync('PRAGMA synchronous=NORMAL;');
db.executeSync('PRAGMA wal_autocheckpoint=100;');
db.executeSync('PRAGMA cache_size=-8000;');
db.executeSync('PRAGMA foreign_keys=ON;');
```

WAL mode is required for the enrollment and sync workload: M1 can write burst
enrollment frames while M4 reads pending sync rows without reader/writer stalls.
Writer-vs-writer contention can still occur and is acceptable.

`cache_size=-8000` configures an 8 MiB page cache, reducing redundant I/O during
LSH lookups across large local profile sets. `foreign_keys=ON` must be enabled
per connection so schema constraints are enforced consistently.

## WAL Sidecar Files

WAL mode creates two files next to the main database:

- `face_auth.db-wal`
- `face_auth.db-shm`

Any backup, migration, export, import, or device-upgrade flow must treat the
main `.db`, `-wal`, and `-shm` files atomically. Copying only the main database
can lose transactions that are committed to WAL but not yet checkpointed into
the main database file.

## Hardware-Derived Passphrase

`KeyDerivation.deriveSQLCipherPassphrase()` owns the device-level DB passphrase:

- Android uses `AndroidKeyStore` alias `offline_face_auth_db_v1`, requesting
  StrongBox on API 28+ and falling back to TEE/software when unavailable.
- iOS uses the `SecureEnclaveManager` native module, falling back to Keychain in
  Simulator or on devices where Secure Enclave key creation is unavailable.
- A 32-byte device nonce is stored in MMKV under
  `nayan.secure-storage.db-key-v1`; the native module encrypts that nonce and
  JS stores the resulting base64 envelope so SQLCipher receives a stable
  passphrase across app restarts.

Per-person DEK/KEK escrow is intentionally not part of T3.1.
