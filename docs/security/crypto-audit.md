# Path: OfflineFaceAuth/docs/security/crypto-audit.md
# Purpose: Cryptographic audit document (M3) with secure storage architecture, key lifecycle, ledger integrity, erasure guarantees, and performance rationale.

# Cryptographic Audit & Secure Storage Architecture Document

This document describes the secure storage and cryptographic architecture owned
by M3 for the offline React Native facial recognition application. The design
goals are:

- protect biometric templates at rest on lost, stolen, or inspected devices;
- preserve offline verification and attendance capture without a network
  dependency;
- allow concurrent enrollment, verification, and background sync without UI
  thread stalls;
- provide enterprise recovery and auditability without weakening normal device
  security;
- support DPDPA-style right-to-erasure through both logical deletion and
  cryptographic shredding.

The architecture uses SQLCipher-backed SQLite storage, hardware-backed keys,
AES-256-GCM authenticated encryption, per-personnel key isolation, a
tamper-evident attendance ledger, and an LSH index for sublinear vector lookup.

## 1. SQLCipher & WAL Mode Concurrency

The application uses a SQLCipher-enabled React Native SQLite binding with the
quick-sqlite/op-sqlite execution model. SQLCipher is enabled at database open by
passing the derived `encryptionKey` into `open(...)`, ensuring the database is
keyed before migrations, PRAGMAs, or application SQL statements execute. The
native build is explicitly checked for SQLCipher support before production
database initialization proceeds.

The database connection is configured for write-ahead logging:

```sql
PRAGMA journal_mode=WAL;
PRAGMA synchronous=NORMAL;
PRAGMA foreign_keys=ON;
```

WAL is a concurrency requirement, not only a performance preference. In rollback
journal mode, a writer can block readers and a reader can prolong writer
completion. That behavior is unacceptable for the app's offline workload:

- M1 inference/enrollment writes a burst of enrollment data, including a
  5-frame capture-derived embedding, consent metadata, LSH buckets, and ledger
  events.
- M4 background sync simultaneously reads pending attendance or queue rows for
  upload.
- The React Native UI thread must remain responsive while those operations
  occur on native and JS execution paths.

With WAL mode, readers continue reading a consistent snapshot while the writer
appends new frames to the WAL. This lets the background sync thread read already
committed rows while the enrollment path writes a short burst transaction.
Writer-vs-writer contention is still serialized by SQLite, but the dominant
sync-vs-enrollment read/write conflict is removed from the UI-critical path.

Checkpointing is deliberately treated as a background maintenance task. A
bounded checkpoint policy such as `wal_autocheckpoint=100` keeps the WAL from
growing unbounded in deployments that prefer SQLite's automatic threshold. The
current implementation uses explicit PASSIVE checkpoints with automatic
checkpointing disabled so checkpoint work can be scheduled after safe events
such as app foreground/background transitions, idle windows, or successful M4
upload acknowledgements. The security and concurrency principle is the same:
checkpointing must not force active readers or writers to wait in the hot
enrollment/verification path.

PASSIVE checkpoints are used for background maintenance:

```sql
PRAGMA wal_checkpoint(PASSIVE);
```

PASSIVE mode attempts to move committed WAL frames back into the main database
without blocking active readers or writers. If a reader pins old WAL frames, the
checkpoint records partial progress and the scheduler retries later. This gives
the system bounded storage behavior while preserving responsiveness during
camera inference, liveness checks, enrollment bursts, and sync reads.

## 2. Dual-Key Escrow & Biometric Encryption (AES-256-GCM)

Biometric embeddings are protected by a three-tier key hierarchy that separates
database confidentiality, normal operational access, and enterprise recovery.

Tier 1 is the device database protection layer. A device-scoped hardware-backed
key, `offline_face_auth_db_v1`, is created through Android Keystore with
StrongBox preference where available, or through the iOS Secure Enclave/Keychain
path. This key derives the stable SQLCipher passphrase used to encrypt the
entire local database. The SQLCipher key protects schema data, attendance
records, LSH bucket rows, consent metadata, and encrypted biometric blobs as a
whole.

Tier 2 is the per-personnel biometric data encryption layer. During enrollment,
the application generates a fresh 32-byte AES-256 data encryption key (DEK) in
memory. The DEK is not stored in plaintext in SQLite, MMKV, logs, or application
state. It is used to encrypt the enrolled 128-dimensional float32 embedding and
then is zeroed as far as JavaScript and native memory boundaries permit.

Tier 3 is the wrapping/escrow layer. The same DEK is wrapped independently in
two ways:

- A hardware-backed per-personnel key encryption key (KEK), named
  `face_embed_key_{personnelId}`, wraps the DEK for normal offline operation.
  Android uses AES-GCM keys in Android Keystore, preferring StrongBox on API 28+
  and falling back to TEE-backed Keystore when StrongBox is unavailable. iOS uses
  the corresponding Secure Enclave/Keychain-backed native path. Verification
  unwraps the DEK only when needed to decrypt that person's embedding.
- An enterprise Admin RSA-4096 public key wraps the DEK independently for
  controlled recovery using RSA-OAEP with SHA-256. Only the public key is
  bundled in the app. The private key remains outside the app bundle and is used
  only by the admin recovery workflow.

The embedding itself is encrypted using AES-256-GCM:

```text
plaintext: 128 float32 values = 512 bytes
ciphertext blob: [12-byte IV][ciphertext][16-byte GCM tag]
```

GCM was selected because it provides confidentiality and authentication in one
primitive. A successful decrypt proves that the ciphertext, IV, authentication
tag, key, and AAD all match. Corruption, rollback of the encrypted blob, or row
substitution causes authentication failure rather than returning unauthenticated
biometric data.

The `personnel_id` is passed as Additional Authenticated Data (AAD). This is a
critical row-binding control. A database attacker who copies Alice's
`encrypted_embed` into Bob's row cannot make the application decrypt Alice's
embedding as Bob's, because AES-GCM authentication was computed over Alice's
`personnel_id`. Decryption under Bob's `personnel_id` fails the authentication
tag check. This prevents ciphertext row-swapping attacks even if the attacker
can directly mutate SQLCipher contents after the database is unlocked.

Operationally, the app avoids pre-caching plaintext DEKs. The unwrap/decrypt
path is intentionally scoped to the verification operation, reducing key
material lifetime while keeping offline verification possible.

## 3. DPDPA-Compliant Right-to-Erasure (Hard & Soft Purge)

Right-to-erasure is implemented as a two-layer purge model: a logical database
purge and a cryptographic hard purge. The two layers serve different audit and
privacy purposes.

The soft purge removes or detaches application records through SQL DELETE and
foreign-key cascade semantics:

- the `personnel` row is deleted;
- `lsh_index` rows for the personnel identifier are deleted;
- consent records are deleted;
- attendance ledger rows are retained for audit continuity but are anonymized by
  removing `personnel_id` and marking `consent_withdrawn = 1`;
- ledger payload hashes are backfilled before erasure where necessary so the
  tamper-evident chain can remain verifiable without retaining decryptable
  biometric/personnel payloads.

This soft purge removes the person from application search, verification, and
normal database queries. It also preserves the minimum audit record needed to
prove that an erasure event occurred without continuing to expose a direct
identifier in historical attendance data.

The hard purge destroys the user's per-personnel hardware-backed KEK:

```text
face_embed_key_{personnelId} -> Keystore deleteEntry / platform key deletion
```

Because each person's DEK is wrapped by a unique hardware-backed KEK, deleting
that KEK cryptographically shreds the wrapped DEK. Once the KEK is destroyed,
the encrypted AES-GCM embedding blob and any encrypted ledger payloads that
depend on the same personnel key become permanently unrecoverable through the
normal device path. This design avoids the common failure mode of a single
global biometric key: erasing one person does not require rotating every other
person's key, and deleting one person's key does not affect other enrolled
users.

This per-person key model is the privacy boundary that makes the erasure
credible. SQL deletion removes references and searchability; key destruction
removes the cryptographic ability to recover the biometric template.

The erasure workflow also creates a deletion receipt. The device signs the
receipt using a non-exportable ECDSA P-256 device identity key. The receipt
contains the personnel identifier, device identity, purge timestamp, uptime
anchor, command nonce, and signature. If the network is unavailable, receipts
are queued and uploaded later. This gives the enterprise an auditable proof that
the erasure command was executed by a legitimate device key without exporting
the signing private key.

## 4. Blockchain-Style Ledger & Monotonic Clock Anchor

Attendance, enrollment, verification, rejection, and erasure events are appended
to an offline ledger. The ledger is designed to be tamper-evident while the
device is offline, so M4 can sync records later without assuming continuous
server connectivity.

Each ledger row stores:

- `prev_hash`, pointing to the prior committed event hash;
- `current_hash`, the hash of the current event and chain context;
- `payload_hash`, allowing payload verification even after encrypted payloads
  are redacted for erasure;
- wall-clock timestamp `ts`;
- monotonic uptime `uptime_ms`;
- strictly increasing `event_counter`;
- encrypted or redacted payload metadata.

Conceptually, the current event hash is computed as:

```text
SHA256(prev_hash | payload | wall_ts | uptime_ms | event_counter)
```

In the implementation, `payload` is first canonicalized and hashed into
`payload_hash`; the fixed-length `payload_hash` is then used as the payload term
inside `current_hash`. This preserves the same integrity binding while allowing
payload redaction after erasure. For non-redacted payloads, canonicalization
ensures field ordering cannot create ambiguous representations. The verifier
reads rows in `event_counter` order and recomputes the hash chain. It rejects:

- changed payloads;
- changed `ts` values;
- changed `uptime_ms` values;
- event-counter gaps or reordering;
- broken `prev_hash` links;
- wall-clock rollback relative to the previous event;
- encrypted payload authentication failure.

Including `SystemClock.elapsedRealtime()` as `uptime_ms` materially improves
timestamp integrity. A user can manually change the device wall clock, but they
cannot arbitrarily rewind the monotonic elapsed-time counter without rebooting
the device. By binding both wall time and uptime into the hash chain, the ledger
detects simple wall-clock tampering that would otherwise fake attendance times.

Device reboots are handled by the `boot_session_anchors` table. For each ledger
event, the app stores a mapping between wall-clock time, uptime, event id, and a
session hash:

```text
session_hash = SHA256(wall_ts | uptime_ms | ledger_id)
```

These anchors let the verifier and sync/audit layer reason about clock drift
across boot sessions. Within one boot session, uptime must move monotonically.
Across reboots, the anchor history records the relationship between wall-clock
time and the new uptime origin, making suspicious jumps visible during audit and
server reconciliation.

The ledger is not a consensus blockchain. It is a local append-only hash chain
optimized for offline tamper detection. Its purpose is to make unauthorized
mutation evident before sync and to give the server a compact proof of local
event ordering.

## 5. O(log N) LSH Vector Index

Encrypted biometric templates cannot be searched directly as floats in SQL
without decrypting every row. A linear scan over 5,000+ personnel profiles would
force the verification path to unwrap and decrypt thousands of embeddings, which
is both slow and undesirable for key exposure.

The application therefore maintains a Locality-Sensitive Hashing (LSH) index.
At enrollment, the plaintext embedding is projected through immutable random
hyperplanes and converted into bucket keys. The current index uses:

- 4 bands;
- 6 random hyperplanes per band;
- 128-dimensional float32 embeddings;
- deterministic hyperplane constants stored in source control;
- SQL rows keyed by `bucket_key`, `band_index`, and `personnel_id`.

At verification, the live embedding is projected through the same hyperplanes.
Only personnel identifiers in matching buckets are returned as candidates. The
verification path then decrypts only those candidate embeddings and runs exact
similarity scoring on the reduced candidate set.

This design avoids full-table scans of encrypted embeddings. The LSH index is
not a substitute for cryptographic protection; it is a performance filter over
non-secret bucket metadata. The biometric template remains encrypted with
AES-256-GCM, and the LSH result only determines which encrypted rows need to be
opened for final comparison.

In benchmark coverage, the LSH lookup path remains comfortably below the
interactive budget for 100, 1,000, and 5,000 profile datasets, with 5,000-profile
median lookup latency under 5 ms in the Jest/native-projection benchmark. This
keeps field verification responsive while preserving the stronger security
property: only a small candidate set requires DEK unwrap and embedding decrypt.
