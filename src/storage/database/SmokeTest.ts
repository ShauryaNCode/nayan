/**
 * SQLCipher Smoke Test — NAYAN Phase 0
 *
 * Validates the complete storage stack:
 * 1. Open an encrypted SQLCipher database
 * 2. Create a test table
 * 3. INSERT a row (simulating personnel enrollment)
 * 4. SELECT it back
 * 5. Assert all fields match exactly
 * 6. DROP the table
 * 7. Close the database
 *
 * Returns structured results for the UI to display.
 */
import {
  isSQLCipher,
  open,
  type DB,
} from '@op-engineering/op-sqlite';
import {MMKV} from 'react-native-mmkv';

import {deriveSQLCipherPassphrase} from '../encryption/KeyDerivation';
import {configureDatabasePragmas} from './DatabaseManager';
import {runMigrations} from './migrations/MigrationRunner';

export interface SmokeTestStep {
  name: string;
  passed: boolean;
  detail: string;
}

export interface SmokeTestResult {
  passed: boolean;
  steps: SmokeTestStep[];
  durationMs: number;
}

const TEST_DB_NAME = 'nayan_t3_1_smoke_test.db';
const TEST_MMKV_ID = 'nayan.phase0.mmkv.smoke';

function getFirstRow(rows: unknown): any | undefined {
  if (Array.isArray(rows)) {
    return rows[0];
  }

  if (
    rows &&
    typeof rows === 'object' &&
    '_array' in rows &&
    Array.isArray(rows._array)
  ) {
    return rows._array[0];
  }

  if (
    rows &&
    typeof rows === 'object' &&
    'item' in rows &&
    typeof rows.item === 'function'
  ) {
    return rows.item(0);
  }

  return undefined;
}

export async function runSQLCipherSmokeTest(): Promise<SmokeTestResult> {
  const steps: SmokeTestStep[] = [];
  const startTime = Date.now();
  let db: DB | null = null;

  try {
    // Step 1: Confirm the native module was built with SQLCipher enabled.
    try {
      const sqlCipherBuildEnabled = isSQLCipher();
      steps.push({
        name: 'Verify SQLCipher build',
        passed: sqlCipherBuildEnabled,
        detail: sqlCipherBuildEnabled
          ? 'op-sqlite reports SQLCipher support is compiled in'
          : 'op-sqlite reports plain SQLite; rebuild after installing with SQLCipher config',
      });

      if (!sqlCipherBuildEnabled) {
        return buildResult(steps, startTime);
      }
    } catch (error) {
      steps.push({
        name: 'Verify SQLCipher build',
        passed: false,
        detail: `Failed: ${String(error)}`,
      });
      return buildResult(steps, startTime);
    }

    // Step 2: Derive hardware-backed SQLCipher passphrase.
    let encryptionKey = '';
    try {
      const passphraseResult = await deriveSQLCipherPassphrase();
      encryptionKey = passphraseResult.passphrase;
      steps.push({
        name: 'Derive SQLCipher passphrase',
        passed: true,
        detail:
          `provider=${passphraseResult.provider}; ` +
          `alias=${passphraseResult.keyAlias}; ` +
          `cached=${String(passphraseResult.restoredFromCache)}`,
      });
    } catch (error) {
      steps.push({
        name: 'Derive SQLCipher passphrase',
        passed: false,
        detail: `Failed: ${String(error)}`,
      });
      return buildResult(steps, startTime);
    }

    // Step 3: Open encrypted database.
    try {
      db = open({
        name: TEST_DB_NAME,
        encryptionKey,
      });
      steps.push({
        name: 'Open encrypted DB',
        passed: true,
        detail: `SQLCipher DB "${TEST_DB_NAME}" opened with AES-256 encryption`,
      });
    } catch (error) {
      steps.push({
        name: 'Open encrypted DB',
        passed: false,
        detail: `Failed: ${String(error)}`,
      });
      return buildResult(steps, startTime);
    }

    // Step 4: Verify SQLCipher is active (not plain SQLite).
    try {
      const cipherResult = await db.execute('PRAGMA cipher_version;');
      const cipherRow = getFirstRow(cipherResult.rows);
      const cipherVersion =
        cipherRow?.cipher_version ?? cipherRow?.[0] ?? 'unknown';
      const cipherActive = cipherVersion !== 'unknown' && cipherVersion !== '';
      steps.push({
        name: 'Verify SQLCipher active',
        passed: cipherActive,
        detail: cipherActive
          ? `SQLCipher version: ${cipherVersion}`
          : 'PRAGMA cipher_version returned empty; plain SQLite detected',
      });
      if (!cipherActive) {
        return buildResult(steps, startTime);
      }
    } catch (error) {
      steps.push({
        name: 'Verify SQLCipher active',
        passed: false,
        detail: `Failed: ${String(error)}`,
      });
      return buildResult(steps, startTime);
    }

    // Step 5: Initialize PRAGMAs before schema migration or app statements.
    try {
      const pragmaState = configureDatabasePragmas(db);
      const walEnabled = pragmaState.journalMode === 'wal';
      const synchronousNormal = pragmaState.synchronous === 1;
      const autocheckpointDisabled = pragmaState.walAutocheckpoint === 0;
      const cacheSized = pragmaState.cacheSizeKiB === -8000;
      const foreignKeysEnabled = pragmaState.foreignKeys;
      steps.push({
        name: 'Initialize database PRAGMAs',
        passed:
          walEnabled &&
          synchronousNormal &&
          autocheckpointDisabled &&
          cacheSized &&
          foreignKeysEnabled,
        detail:
          `journal_mode=${pragmaState.journalMode}; ` +
          `synchronous=${pragmaState.synchronous}; ` +
          `wal_autocheckpoint=${pragmaState.walAutocheckpoint}; ` +
          `cache_size=${pragmaState.cacheSizeKiB}; ` +
          `foreign_keys=${String(pragmaState.foreignKeys)}`,
      });

      if (
        !walEnabled ||
        !synchronousNormal ||
        !autocheckpointDisabled ||
        !cacheSized ||
        !foreignKeysEnabled
      ) {
        return buildResult(steps, startTime);
      }
    } catch (error) {
      steps.push({
        name: 'Initialize database PRAGMAs',
        passed: false,
        detail: `Failed: ${String(error)}`,
      });
      return buildResult(steps, startTime);
    }

    // Step 6: Run production migrations.
    try {
      const migrationResult = runMigrations(db);
      steps.push({
        name: 'Run schema migrations',
        passed: true,
        detail: `Latest migration version: ${migrationResult.latestVersion}`,
      });
    } catch (error) {
      steps.push({
        name: 'Run schema migrations',
        passed: false,
        detail: `Failed: ${String(error)}`,
      });
      return buildResult(steps, startTime);
    }

    // Step 7: Insert a migrated-schema ledger row.
    const testData = {
      personnel_id: 'NAYAN-P0-001',
      full_name: 'Phase Zero Test User',
      enrolled_at: new Date().toISOString(),
    };

    try {
      await db.transaction(async (tx) => {
        await tx.execute(
          `
            INSERT OR REPLACE INTO personnel (
              personnel_id,
              full_name,
              enrollment_status,
              created_at,
              updated_at
            ) VALUES (?, ?, 'active', ?, ?);
          `,
          [
            testData.personnel_id,
            testData.full_name,
            testData.enrolled_at,
            testData.enrolled_at,
          ],
        );
        await tx.execute(
          `
            INSERT OR REPLACE INTO attendance_ledger (
              ledger_id,
              personnel_id,
              event_type,
              captured_at,
              device_id,
              confidence,
              liveness_score,
              payload_json,
              previous_hash,
              current_hash,
              chain_index,
              synced,
              created_at
            ) VALUES (?, ?, 'verification', ?, ?, ?, ?, ?, ?, ?, ?, 0, ?);
          `,
          [
            'NAYAN-SMOKE-LEDGER-001',
            testData.personnel_id,
            testData.enrolled_at,
            'smoke-test-device',
            0.99,
            1,
            '{"source":"t3.1-smoke-test"}',
            'GENESIS',
            'SMOKE_TEST_HASH',
            1,
            testData.enrolled_at,
          ],
        );
      });
      steps.push({
        name: 'Insert ledger row',
        passed: true,
        detail: `Inserted unsynced ledger row for ${testData.personnel_id}`,
      });
    } catch (error) {
      steps.push({
        name: 'Insert ledger row',
        passed: false,
        detail: `Failed: ${String(error)}`,
      });
      return buildResult(steps, startTime);
    }

    // Step 8: Read it back through M4's synced=0 access path.
    try {
      const selectResult = await db.execute(
        `
          SELECT ledger_id, personnel_id, synced
          FROM attendance_ledger
          WHERE synced = 0
          ORDER BY chain_index ASC
          LIMIT 1;
        `,
      );

      const row = getFirstRow(selectResult.rows);
      if (!row) {
        steps.push({
          name: 'Read back & assert',
          passed: false,
          detail: 'No rows returned from SELECT',
        });
        return buildResult(steps, startTime);
      }

      // Handle both object-style and array-style row access.
      const readLedgerId = row.ledger_id ?? row[0];
      const readPersonnelId = row.personnel_id ?? row[1];
      const readSynced = Number(row.synced ?? row[2]);

      const allMatch =
        readLedgerId === 'NAYAN-SMOKE-LEDGER-001' &&
        readPersonnelId === testData.personnel_id &&
        readSynced === 0;

      steps.push({
        name: 'Read back & assert',
        passed: allMatch,
        detail: allMatch
          ? `M4 synced=0 query returned ledger_id=${readLedgerId}`
          : `Mismatch! ledger_id:${readLedgerId} personnel:${readPersonnelId} synced:${readSynced}`,
      });

      if (!allMatch) {
        return buildResult(steps, startTime);
      }
    } catch (error) {
      steps.push({
        name: 'Read back & assert',
        passed: false,
        detail: `Failed: ${String(error)}`,
      });
      return buildResult(steps, startTime);
    }

    // Step 9: Cleanup test rows.
    try {
      await db.execute('DELETE FROM attendance_ledger WHERE ledger_id = ?;', [
        'NAYAN-SMOKE-LEDGER-001',
      ]);
      await db.execute('DELETE FROM personnel WHERE personnel_id = ?;', [
        testData.personnel_id,
      ]);
      steps.push({
        name: 'Cleanup rows',
        passed: true,
        detail: 'Smoke-test personnel and ledger rows deleted',
      });
    } catch (error) {
      steps.push({
        name: 'Cleanup rows',
        passed: false,
        detail: `Failed: ${String(error)}`,
      });
    }

    // Step 10: Close database.
    try {
      db.close();
      db = null;
      steps.push({
        name: 'Close database',
        passed: true,
        detail: 'Database closed and resources released',
      });
    } catch (error) {
      steps.push({
        name: 'Close database',
        passed: false,
        detail: `Failed: ${String(error)}`,
      });
    }
  } catch (error) {
    steps.push({
      name: 'Unexpected error',
      passed: false,
      detail: String(error),
    });
  } finally {
    // Safety: ensure DB is closed even on unexpected errors.
    if (db) {
      try {
        db.close();
      } catch (_) {
        // Ignore close errors in cleanup
      }
    }
  }

  return buildResult(steps, startTime);
}

export function runMMKVSmokeTest(): SmokeTestResult {
  const steps: SmokeTestStep[] = [];
  const startTime = Date.now();
  const keys = {
    string: 'phase0.string',
    number: 'phase0.number',
    boolean: 'phase0.boolean',
    buffer: 'phase0.buffer',
  };

  let storage: MMKV | null = null;

  try {
    try {
      storage = new MMKV({id: TEST_MMKV_ID});
      steps.push({
        name: 'Open MMKV store',
        passed: true,
        detail: `MMKV instance "${TEST_MMKV_ID}" opened`,
      });
    } catch (error) {
      steps.push({
        name: 'Open MMKV store',
        passed: false,
        detail: `Failed: ${String(error)}`,
      });
      return buildResult(steps, startTime);
    }

    try {
      storage.set(keys.string, 'Phase Zero MMKV Test');
      storage.set(keys.number, 73.6);
      storage.set(keys.boolean, true);
      storage.set(keys.buffer, new Uint8Array([78, 65, 89, 65, 78]));
      steps.push({
        name: 'Write values',
        passed: true,
        detail: 'Stored string, number, boolean, and buffer values',
      });
    } catch (error) {
      steps.push({
        name: 'Write values',
        passed: false,
        detail: `Failed: ${String(error)}`,
      });
      return buildResult(steps, startTime);
    }

    try {
      const stringValue = storage.getString(keys.string);
      const numberValue = storage.getNumber(keys.number);
      const booleanValue = storage.getBoolean(keys.boolean);
      const bufferValue = storage.getBuffer(keys.buffer);
      const bufferText = bufferValue
        ? String.fromCharCode(...Array.from(bufferValue))
        : undefined;

      const allMatch =
        stringValue === 'Phase Zero MMKV Test' &&
        numberValue === 73.6 &&
        booleanValue === true &&
        bufferText === 'NAYAN';

      steps.push({
        name: 'Read back & assert',
        passed: allMatch,
        detail: allMatch
          ? 'All 4 MMKV values match'
          : `Mismatch! string:${stringValue} number:${numberValue} boolean:${booleanValue} buffer:${bufferText}`,
      });

      if (!allMatch) {
        return buildResult(steps, startTime);
      }
    } catch (error) {
      steps.push({
        name: 'Read back & assert',
        passed: false,
        detail: `Failed: ${String(error)}`,
      });
      return buildResult(steps, startTime);
    }

    try {
      const containsAll =
        storage.contains(keys.string) &&
        storage.contains(keys.number) &&
        storage.contains(keys.boolean) &&
        storage.contains(keys.buffer);

      steps.push({
        name: 'Verify keys exist',
        passed: containsAll,
        detail: containsAll
          ? 'MMKV contains all smoke-test keys'
          : 'One or more MMKV smoke-test keys are missing',
      });

      if (!containsAll) {
        return buildResult(steps, startTime);
      }
    } catch (error) {
      steps.push({
        name: 'Verify keys exist',
        passed: false,
        detail: `Failed: ${String(error)}`,
      });
      return buildResult(steps, startTime);
    }

    try {
      storage.delete(keys.string);
      storage.delete(keys.number);
      storage.delete(keys.boolean);
      storage.delete(keys.buffer);

      const cleanedUp =
        !storage.contains(keys.string) &&
        !storage.contains(keys.number) &&
        !storage.contains(keys.boolean) &&
        !storage.contains(keys.buffer);

      steps.push({
        name: 'Cleanup keys',
        passed: cleanedUp,
        detail: cleanedUp
          ? 'Smoke-test keys deleted'
          : 'One or more smoke-test keys remain after cleanup',
      });
    } catch (error) {
      steps.push({
        name: 'Cleanup keys',
        passed: false,
        detail: `Failed: ${String(error)}`,
      });
    }
  } catch (error) {
    steps.push({
      name: 'Unexpected error',
      passed: false,
      detail: String(error),
    });
  }

  return buildResult(steps, startTime);
}

function buildResult(
  steps: SmokeTestStep[],
  startTime: number,
): SmokeTestResult {
  return {
    passed: steps.every((s) => s.passed),
    steps,
    durationMs: Date.now() - startTime,
  };
}
