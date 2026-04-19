import { Database } from "bun:sqlite";
import { createHash } from "crypto";
import { existsSync, mkdirSync, rmSync } from "fs";
import { dirname, resolve } from "path";
import type { AdapterConfig } from "../config";
import type {
  DiscoveryCacheCapableAdapter,
  DiscoveryCacheSourceState,
  DiscoveryCacheState,
} from "../adapters/discovery-cache";

const CACHE_SCHEMA_VERSION = 1;
const DEFAULT_SQLITE_CACHE_SIZE_KIB = 2048;

type CacheMetaRow = {
  adapter_id: string;
  config_fingerprint: string;
  adapter_contract_version: number;
  payload_version: number;
  last_used_at: string;
  cached_sources: number;
  invalidated_sources: number;
  fresh_sources: number;
  last_invalidation_reason: string;
  last_disabled_reason: string;
};

type SourceStateRow = {
  source_path: string;
  source_kind: string;
  size_bytes: number;
  mtime_ms: number;
  signature: string;
  payload_json: string;
};

export interface DiscoveryCacheLoadResult {
  state: DiscoveryCacheState | null;
  cachedSources: number;
  invalidationReason?: string;
  disabledReason?: string;
}

export interface DiscoveryCacheRunSummary {
  cachedSources: number;
  invalidatedSources: number;
  freshSources: number;
  invalidationReason?: string;
  disabledReason?: string;
}

export interface DiscoveryCacheStatusRow {
  adapterId: string;
  configFingerprint: string;
  adapterContractVersion: number;
  payloadVersion: number;
  cachedSources: number;
  invalidatedSources: number;
  freshSources: number;
  lastUsedAt: string;
  lastInvalidationReason: string;
  lastDisabledReason: string;
}

export class SqliteDiscoveryCache {
  readonly dbPath: string;
  readonly database: Database;
  private disabledReason: string | null = null;
  private readonly loadMetaStatement;
  private readonly loadRowsStatement;
  private readonly statusStatement;

  constructor(dbPath: string) {
    const resolvedPath = resolve(dbPath);
    const directory = dirname(resolvedPath);
    if (!existsSync(directory)) {
      mkdirSync(directory, { recursive: true });
    }

    this.dbPath = resolvedPath;
    this.database = new Database(resolvedPath);
    this.database.exec("PRAGMA journal_mode = WAL");
    this.database.exec("PRAGMA busy_timeout = 5000");
    this.database.exec(`PRAGMA cache_size = -${DEFAULT_SQLITE_CACHE_SIZE_KIB}`);
    runDiscoveryCacheMigrations(this.database);

    this.loadMetaStatement = this.database.prepare(`
      SELECT
        adapter_id,
        config_fingerprint,
        adapter_contract_version,
        payload_version,
        last_used_at,
        cached_sources,
        invalidated_sources,
        fresh_sources,
        last_invalidation_reason,
        last_disabled_reason
      FROM adapter_cache_meta
      WHERE adapter_id = ?1 AND config_fingerprint = ?2
    `);
    this.loadRowsStatement = this.database.prepare(`
      SELECT
        source_path,
        source_kind,
        size_bytes,
        mtime_ms,
        signature,
        payload_json
      FROM adapter_source_state
      WHERE adapter_id = ?1 AND config_fingerprint = ?2
      ORDER BY source_path
    `);
    this.statusStatement = this.database.prepare(`
      SELECT
        adapter_id,
        config_fingerprint,
        adapter_contract_version,
        payload_version,
        last_used_at,
        cached_sources,
        invalidated_sources,
        fresh_sources,
        last_invalidation_reason,
        last_disabled_reason
      FROM adapter_cache_meta
      ORDER BY adapter_id
    `);
  }

  loadForAdapter(
    adapter: DiscoveryCacheCapableAdapter & { id: string },
    adapterConfig: AdapterConfig,
  ): DiscoveryCacheLoadResult {
    if (this.disabledReason) {
      return {
        state: null,
        cachedSources: 0,
        disabledReason: this.disabledReason,
      };
    }

    const fingerprint = discoveryConfigFingerprint(adapter, adapterConfig);

    try {
      const meta = this.loadMetaStatement.get(adapter.id, fingerprint) as
        | CacheMetaRow
        | null
        | undefined;
      if (!meta) {
        return { state: null, cachedSources: 0 };
      }

      if (meta.payload_version !== adapter.discoveryCachePayloadVersion) {
        this.invalidateFingerprint(
          adapter.id,
          fingerprint,
          "payload-version-mismatch",
        );
        return {
          state: null,
          cachedSources: 0,
          invalidationReason: "payload-version-mismatch",
        };
      }

      const rows = this.loadRowsStatement.all(adapter.id, fingerprint) as SourceStateRow[];
      const sources: DiscoveryCacheSourceState[] = [];
      for (const row of rows) {
        try {
          sources.push({
            sourcePath: row.source_path,
            sourceKind: row.source_kind,
            sizeBytes: row.size_bytes,
            mtimeMs: row.mtime_ms,
            signature: row.signature,
            payload: JSON.parse(row.payload_json),
          });
        } catch {
          this.invalidateFingerprint(
            adapter.id,
            fingerprint,
            "malformed-payload-json",
          );
          return {
            state: null,
            cachedSources: 0,
            invalidationReason: "malformed-payload-json",
          };
        }
      }

      return {
        state: { sources },
        cachedSources: sources.length,
      };
    } catch (error) {
      this.disableForLifetime(`cache-read-failed:${formatCacheError(error)}`);
      return {
        state: null,
        cachedSources: 0,
        disabledReason: this.disabledReason ?? undefined,
      };
    }
  }

  saveForAdapter(
    adapter: DiscoveryCacheCapableAdapter & { id: string },
    adapterConfig: AdapterConfig,
    state: DiscoveryCacheState,
    summary: DiscoveryCacheRunSummary,
  ): void {
    if (this.disabledReason) {
      return;
    }

    const fingerprint = discoveryConfigFingerprint(adapter, adapterConfig);
    const updatedAt = new Date().toISOString();

    try {
      const save = this.database.transaction(() => {
        this.database
          .prepare(
            "DELETE FROM adapter_source_state WHERE adapter_id = ?1 AND config_fingerprint != ?2",
          )
          .run(adapter.id, fingerprint);
        this.database
          .prepare(
            "DELETE FROM adapter_cache_meta WHERE adapter_id = ?1 AND config_fingerprint != ?2",
          )
          .run(adapter.id, fingerprint);
        this.database
          .prepare(
            "DELETE FROM adapter_source_state WHERE adapter_id = ?1 AND config_fingerprint = ?2",
          )
          .run(adapter.id, fingerprint);

        const insertRow = this.database.prepare(`
          INSERT INTO adapter_source_state (
            adapter_id,
            config_fingerprint,
            source_path,
            source_kind,
            size_bytes,
            mtime_ms,
            signature,
            payload_version,
            payload_json,
            updated_at
          ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
        `);

        for (const source of state.sources) {
          insertRow.run(
            adapter.id,
            fingerprint,
            source.sourcePath,
            source.sourceKind,
            source.sizeBytes,
            source.mtimeMs,
            source.signature,
            adapter.discoveryCachePayloadVersion,
            JSON.stringify(source.payload),
            updatedAt,
          );
        }

        this.database
          .prepare(`
            INSERT INTO adapter_cache_meta (
              adapter_id,
              config_fingerprint,
              adapter_contract_version,
              payload_version,
              last_used_at,
              cached_sources,
              invalidated_sources,
              fresh_sources,
              last_invalidation_reason,
              last_disabled_reason
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
            ON CONFLICT(adapter_id, config_fingerprint) DO UPDATE SET
              adapter_contract_version = excluded.adapter_contract_version,
              payload_version = excluded.payload_version,
              last_used_at = excluded.last_used_at,
              cached_sources = excluded.cached_sources,
              invalidated_sources = excluded.invalidated_sources,
              fresh_sources = excluded.fresh_sources,
              last_invalidation_reason = excluded.last_invalidation_reason,
              last_disabled_reason = excluded.last_disabled_reason
          `)
          .run(
            adapter.id,
            fingerprint,
            adapter.discoveryCacheContractVersion,
            adapter.discoveryCachePayloadVersion,
            updatedAt,
            summary.cachedSources,
            summary.invalidatedSources,
            summary.freshSources,
            summary.invalidationReason ?? "",
            summary.disabledReason ?? "",
          );
      });

      save();
    } catch (error) {
      this.disableForLifetime(`cache-write-failed:${formatCacheError(error)}`);
    }
  }

  getStatusRows(): DiscoveryCacheStatusRow[] {
    try {
      return (this.statusStatement.all() as CacheMetaRow[]).map((row) => ({
        adapterId: row.adapter_id,
        configFingerprint: row.config_fingerprint,
        adapterContractVersion: row.adapter_contract_version,
        payloadVersion: row.payload_version,
        cachedSources: row.cached_sources,
        invalidatedSources: row.invalidated_sources,
        freshSources: row.fresh_sources,
        lastUsedAt: row.last_used_at,
        lastInvalidationReason: row.last_invalidation_reason,
        lastDisabledReason: row.last_disabled_reason,
      }));
    } catch {
      return [];
    }
  }

  clear(): void {
    this.database.exec("DELETE FROM adapter_source_state");
    this.database.exec("DELETE FROM adapter_cache_meta");
  }

  close(): void {
    try {
      this.database.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    } catch {
      // Best effort.
    }
    this.database.close();
  }

  removeFiles(): void {
    this.close();
    for (const suffix of ["", "-shm", "-wal"]) {
      rmSync(`${this.dbPath}${suffix}`, { force: true });
    }
  }

  private invalidateFingerprint(
    adapterId: string,
    fingerprint: string,
    reason: string,
  ): void {
    const invalidate = this.database.transaction(() => {
      this.database
        .prepare(
          "DELETE FROM adapter_source_state WHERE adapter_id = ?1 AND config_fingerprint = ?2",
        )
        .run(adapterId, fingerprint);
      this.database
        .prepare(`
          INSERT INTO adapter_cache_meta (
            adapter_id,
            config_fingerprint,
            adapter_contract_version,
            payload_version,
            last_used_at,
            cached_sources,
            invalidated_sources,
            fresh_sources,
            last_invalidation_reason,
            last_disabled_reason
          ) VALUES (?1, ?2, 0, 0, ?3, 0, 0, 0, ?4, '')
          ON CONFLICT(adapter_id, config_fingerprint) DO UPDATE SET
            last_used_at = excluded.last_used_at,
            cached_sources = 0,
            invalidated_sources = 0,
            fresh_sources = 0,
            last_invalidation_reason = excluded.last_invalidation_reason
        `)
        .run(adapterId, fingerprint, new Date().toISOString(), reason);
    });

    invalidate();
  }

  private disableForLifetime(reason: string): void {
    if (!this.disabledReason) {
      this.disabledReason = reason;
    }
  }
}

export function discoveryCacheFingerprintInput(
  adapter: Pick<
    DiscoveryCacheCapableAdapter & { id: string },
    "id" | "discoveryCacheContractVersion"
  >,
  adapterConfig: AdapterConfig,
): Record<string, unknown> {
  return {
    adapterId: adapter.id,
    adapterContractVersion: adapter.discoveryCacheContractVersion,
    enabled: adapterConfig.enabled !== false,
    dataDir: normalizeOptionalString(adapterConfig.dataDir),
    allowProtectedSource: adapterConfig.allowProtectedSource === true,
  };
}

export function discoveryConfigFingerprint(
  adapter: Pick<
    DiscoveryCacheCapableAdapter & { id: string },
    "id" | "discoveryCacheContractVersion"
  >,
  adapterConfig: AdapterConfig,
): string {
  return createHash("sha256")
    .update(JSON.stringify(discoveryCacheFingerprintInput(adapter, adapterConfig)))
    .digest("hex");
}

function normalizeOptionalString(value: string | undefined): string {
  if (typeof value !== "string") {
    return "";
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : "";
}

function runDiscoveryCacheMigrations(db: Database): void {
  const currentVersion = getUserVersion(db);
  if (currentVersion >= CACHE_SCHEMA_VERSION) {
    return;
  }

  const migrate = db.transaction(() => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS adapter_cache_meta (
        adapter_id TEXT NOT NULL,
        config_fingerprint TEXT NOT NULL,
        adapter_contract_version INTEGER NOT NULL DEFAULT 0,
        payload_version INTEGER NOT NULL DEFAULT 0,
        last_used_at TEXT NOT NULL DEFAULT '',
        cached_sources INTEGER NOT NULL DEFAULT 0,
        invalidated_sources INTEGER NOT NULL DEFAULT 0,
        fresh_sources INTEGER NOT NULL DEFAULT 0,
        last_invalidation_reason TEXT NOT NULL DEFAULT '',
        last_disabled_reason TEXT NOT NULL DEFAULT '',
        PRIMARY KEY (adapter_id, config_fingerprint)
      );

      CREATE TABLE IF NOT EXISTS adapter_source_state (
        adapter_id TEXT NOT NULL,
        config_fingerprint TEXT NOT NULL,
        source_path TEXT NOT NULL,
        source_kind TEXT NOT NULL,
        size_bytes INTEGER NOT NULL DEFAULT 0,
        mtime_ms INTEGER NOT NULL DEFAULT 0,
        signature TEXT NOT NULL DEFAULT '',
        payload_version INTEGER NOT NULL DEFAULT 0,
        payload_json TEXT NOT NULL DEFAULT '{}',
        updated_at TEXT NOT NULL DEFAULT '',
        PRIMARY KEY (adapter_id, config_fingerprint, source_path)
      );

      CREATE INDEX IF NOT EXISTS idx_discovery_source_state_adapter
        ON adapter_source_state(adapter_id, config_fingerprint);
    `);
    db.exec(`PRAGMA user_version = ${CACHE_SCHEMA_VERSION}`);
  });

  migrate();
}

function getUserVersion(db: Database): number {
  const row = db
    .prepare("PRAGMA user_version")
    .get() as { user_version?: number } | undefined;

  return row?.user_version ?? 0;
}

function formatCacheError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}
