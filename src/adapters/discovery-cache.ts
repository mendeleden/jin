import type { Adapter } from "../contracts/adapters";

export type DiscoveryCacheJsonPrimitive = string | number | boolean | null;

export type DiscoveryCacheJsonValue =
  | DiscoveryCacheJsonPrimitive
  | DiscoveryCacheJsonValue[]
  | { [key: string]: DiscoveryCacheJsonValue };

export interface DiscoveryCacheSourceState {
  sourcePath: string;
  sourceKind: string;
  sizeBytes: number;
  mtimeMs: number;
  signature: string;
  payload: DiscoveryCacheJsonValue;
}

export interface DiscoveryCacheState {
  sources: DiscoveryCacheSourceState[];
}

export interface DiscoveryCacheCapableAdapter {
  discoveryCacheContractVersion: number;
  discoveryCachePayloadVersion: number;
  exportDiscoveryState(): DiscoveryCacheState;
  importDiscoveryState(state: DiscoveryCacheState): void;
}

export function isDiscoveryCacheCapableAdapter(
  adapter: Adapter,
): adapter is Adapter & DiscoveryCacheCapableAdapter {
  const candidate = adapter as Adapter & Partial<DiscoveryCacheCapableAdapter>;
  return (
    typeof candidate.discoveryCacheContractVersion === "number" &&
    typeof candidate.discoveryCachePayloadVersion === "number" &&
    typeof candidate.exportDiscoveryState === "function" &&
    typeof candidate.importDiscoveryState === "function"
  );
}
