# Secure Storage and Crypto

This area documents the work owned by M3 for NAYAN: SQLCipher-backed secure
storage, hardware-backed key management, per-person embedding encryption, and
admin escrow for demo recovery.

The implementation is intentionally split into two key layers:

- Device database key: one permanent device key with alias
  `offline_face_auth_db_v1`. This key is used only to derive the SQLCipher
  database passphrase.
- Per-person embedding KEK: one key per enrolled person with alias
  `face_embed_key_{personnelId}`. This key wraps the 32-byte DEK that encrypts
  that person's face embedding.

These two layers must stay separate. The device DB key is never deleted during
normal app use. Per-person keys are designed to be deleted later for
right-to-erasure without affecting other personnel.

## Android Keystore

Main file:

- `android/app/src/main/java/com/offlinefaceauth/keystore/KeystoreManager.java`

What it does:

- Creates AES-256-GCM keys in `AndroidKeyStore`.
- Prefers StrongBox on Android P/API 28+.
- Falls back to TEE/software-backed Android Keystore when StrongBox is not
  available.
- Uses `setUserAuthenticationRequired(false)` so field verification can run
  offline without a device unlock prompt.
- Uses randomized encryption with GCM and no padding.

Implemented methods:

- `getOrCreateAesGcmKey()` returns the permanent DB passphrase derivation key.
- `generatePersonAesGcmKey(personnelId)` creates a new per-person embedding KEK
  and throws if the alias already exists.
- `getPersonAesGcmKey(personnelId)` loads an existing per-person KEK.
- `deletePersonAesGcmKey(personnelId)` deletes the per-person KEK.
- `getHardwareInfo(key)` reports whether a key is StrongBox/TEE backed.

## React Native Bridge

Main Android bridge files:

- `android/app/src/main/java/com/offlinefaceauth/NativeBridge.java`
- `android/app/src/main/java/com/offlinefaceauth/EmbeddingCryptoModule.java`
- `android/app/src/main/java/com/offlinefaceauth/CryptoUtils.java`

Exposed key methods:

- `generateSecureRandomBase64(byteLength)`
- `deriveDatabasePassphrase(nonceBase64)`
- `generatePersonKey(personnelId)`
- `wrapDEK(personnelId, dekHex)`
- `unwrapDEK(personnelId, wrappedDEKBase64)`
- `deletePersonKey(personnelId)`

`wrapDEK` and `unwrapDEK` use AES-GCM with a fresh 12-byte IV. The returned blob
format is:

```text
[IV: 12 bytes][ciphertext][GCM tag: 16 bytes]
```

The TypeScript compatibility wrapper is:

- `src/crypto/NativeSecureKey.ts`

It resolves the active native module from `NativeModules.NativeSecureKey`,
`NativeModules.SecureEnclaveManager`, or `NativeModules.NativeBridge`.

## Embedding Encryption

Main files:

- `src/crypto/EmbeddingCrypto.ts`
- `android/app/src/main/java/com/offlinefaceauth/EmbeddingCryptoModule.java`
- `src/utils/BufferUtils.ts`

Embedding encryption uses AES-256-GCM over the raw 128-D float32 embedding.

Input:

- 128 float32 values
- 512 raw bytes
- base64 encoded at the TypeScript boundary

Encrypted blob:

```text
[IV: 12 bytes][ciphertext: 512 bytes][GCM tag: 16 bytes]
```

Total size: 540 bytes.

AAD is the UTF-8 `personnelId`. This binds the encrypted embedding to its owner
row. If encrypted blobs are swapped between two personnel rows, decryption must
fail with a GCM authentication error.

`EmbeddingCrypto.ts` calls the native module when available and includes a
WebCrypto fallback for tests and compatible JS runtimes.

## Enrollment Flow

Main file:

- `src/storage/EnrollmentService.ts`

Public API:

```ts
EnrollmentService.enroll({
  personnelId,
  name,
  department,
  embedding,
  consentTs,
});
```

Sequence:

1. Generate a random 32-byte DEK with `crypto.getRandomValues`, falling back to
   native secure random when needed.
2. Create the per-person hardware KEK with `generatePersonKey(personnelId)`.
3. Wrap the DEK with the per-person KEK into `kek_hw_wrapped`.
4. Wrap the same DEK with the admin RSA-4096 public key into
   `kek_admin_wrapped`.
5. Encrypt the 512-byte embedding with AES-256-GCM and `personnelId` as AAD.
6. Zero the DEK `Uint8Array` immediately after encryption.
7. Insert the personnel row and consent log row in one database transaction.
8. If the DB write fails after the person key was created, delete the person key
   to avoid orphaned Keystore entries.

## Verification Flow

Main file:

- `src/storage/VerificationService.ts`

Public API:

```ts
VerificationService.decryptEmbedding(personnelId);
```

Sequence:

1. Read `kek_hw_wrapped` and `encrypted_embed` from `personnel`.
2. Unwrap the DEK with the person's hardware KEK.
3. Decrypt the embedding with AES-256-GCM and `personnelId` as AAD.
4. Clear the local DEK hex variable lifetime as much as JS allows.
5. Return a `Float32Array` with 128 values for M1 cosine similarity.

Note: JS strings are immutable, so a DEK hex string cannot be truly overwritten
in-place. The implementation avoids caching DEKs and narrows their lifetime.

## Admin Escrow

Main files:

- `src/crypto/AdminKey.ts`
- `src/crypto/RSAOAEP.ts`
- `src/crypto/AdminEscrow.ts`

The enterprise admin RSA-4096 public key is bundled in `AdminKey.ts`. The private
key is generated locally as `admin_private.pem` and is ignored by git.

Admin escrow is for demo recovery only. It proves an embedding can be recovered
from:

- `personnelId`
- `kek_admin_wrapped`
- `encrypted_embed`
- the offline admin private key PEM

Production enrollment and verification paths must not call admin escrow.
`AdminEscrow.recoverEmbedding` logs a warning prefixed with:

```text
[ADMIN ESCROW - DEMO ONLY]
```

## Database Migration

Main migration file:

- `src/storage/database/migrations/002_person_embedding_crypto.ts`

Adds:

- `personnel.encrypted_embed`
- `personnel.kek_hw_wrapped`
- `personnel.kek_admin_wrapped`
- `personnel.admin_key_version`
- `personnel.enrollment_ts`
- `personnel.consent_ts`
- `consent_log`

The migration is registered in:

- `src/storage/database/migrations/MigrationRunner.ts`

## Tests Added

Main test file:

- `tests/unit/storage/t3_2_embedding_crypto.test.ts`

Coverage:

- Round-trip enrollment and verification.
- Row-swap attack rejection through AES-GCM AAD binding.
- DEK zeroing check at the JS buffer level.
- Admin escrow recovery independent of the hardware key.
- Wrong DEK decryption failure.

Existing SQLCipher tests were updated so the latest migration version is `2`.

## Security Rules

- Never log plaintext DEKs.
- Never store plaintext DEKs in MMKV, SQLite, files, or app state.
- Never reuse the same `(DEK, IV)` pair for embedding encryption.
- Never decrypt or return plaintext when AES-GCM authentication fails.
- Keep `offline_face_auth_db_v1` and `face_embed_key_{personnelId}` aliases
  separate.
- Keep `admin_private.pem` out of git and out of the app bundle.
- Do not pre-cache per-person DEKs for speed. Security wins over sub-5ms
  convenience if Keystore unwrap is the bottleneck.

## Current Caveats

- Android embedding crypto is implemented as a React Native native module using
  platform AES-GCM. The C++/BoringSSL TurboModule shape can replace this bridge
  later without changing the TypeScript API.
- iOS per-person wrapping uses Secure Enclave EC keys with ECIES AES-GCM where
  available, and Keychain fallback on Simulator. This matches the existing iOS
  secure-key pattern.
- Full DEK memory forensics cannot be proven from JS unit tests. Native memory
  profiling is needed for that level of assurance.
