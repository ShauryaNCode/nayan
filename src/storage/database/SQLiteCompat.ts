import type {DB, QueryResult} from '@op-engineering/op-sqlite';

type SyncExecutable = DB & {
  executeSync?: (query: string, params?: unknown[]) => QueryResult;
};

export function executeSql(
  db: DB,
  query: string,
  params?: unknown[],
): QueryResult {
  const executable = db as SyncExecutable;
  if (typeof executable.executeSync === 'function') {
    return executable.executeSync(query, params);
  }
  return db.execute(query, params);
}

export function getRows(result: QueryResult): Array<Record<string, unknown>> {
  const rows = result.rows;
  if (Array.isArray(rows)) {
    return rows as Array<Record<string, unknown>>;
  }
  if (rows?._array != null) {
    return rows._array as Array<Record<string, unknown>>;
  }
  return [];
}

export function getFirstRow(
  result: QueryResult,
): Record<string, unknown> | undefined {
  return getRows(result)[0];
}
