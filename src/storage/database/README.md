# Path: OfflineFaceAuth/src/storage/database/README.md
# Purpose: Documents SQLCipher database architecture with schema design, encryption setup, passphrase derivation from hardware keystore.

## Phase 0 SQLCipher + WAL Initialization

M3 owns the Phase 0 encrypted local database bootstrap. The database must be
opened with the SQLCipher passphrase before any SQL statement is executed. With
op-sqlite this is done by passing `encryptionKey` to `open(...)`; the PRAGMA
sequence below runs immediately after open and before migrations or
application-level reads/writes:

```ts
db.execute('PRAGMA journal_mode=WAL;');
db.execute('PRAGMA synchronous=NORMAL;');
db.execute('PRAGMA wal_autocheckpoint=100;');
db.execute('PRAGMA cache_size=-8000;');
db.execute('PRAGMA foreign_keys=ON;');
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
