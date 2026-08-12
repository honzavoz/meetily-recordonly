import type { DownloadEvent } from "@tauri-apps/plugin-updater";

export interface PreparedUpdate {
  downloadAndInstall(onEvent?: (event: DownloadEvent) => void): Promise<void>;
  close(): Promise<void>;
}

export interface PreparedUpdateInfo {
  available: boolean;
  preparedUpdate?: PreparedUpdate;
}

export async function resolvePreparedUpdate(
  info: PreparedUpdateInfo,
  refresh: () => Promise<PreparedUpdateInfo>,
): Promise<PreparedUpdate> {
  if (info.preparedUpdate) return info.preparedUpdate;

  const refreshed = await refresh();
  if (!refreshed.available || !refreshed.preparedUpdate) {
    throw new Error("Update is no longer available");
  }
  return refreshed.preparedUpdate;
}

export class UpdateOperationGate {
  private running = false;

  get isRunning(): boolean {
    return this.running;
  }

  async run(operation: () => Promise<void>): Promise<boolean> {
    if (this.running) return false;
    this.running = true;
    try {
      await operation();
      return true;
    } finally {
      this.running = false;
    }
  }
}

export class PreparedUpdateRetryState {
  private forceRefresh = false;

  select(
    local: PreparedUpdate | null,
    provided?: PreparedUpdate,
  ): PreparedUpdate | undefined {
    if (this.forceRefresh) return undefined;
    return local ?? provided;
  }

  markFailed(): void {
    this.forceRefresh = true;
  }

  markPrepared(_update: PreparedUpdate): void {
    this.forceRefresh = false;
  }

  reset(): void {
    this.forceRefresh = false;
  }
}

export function normalizeUpdaterError(error: unknown, fallback: string): string {
  if (typeof error === "string" && error.trim()) return error.trim();
  if (error instanceof Error && error.message.trim()) return error.message.trim();
  if (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof error.message === "string" &&
    error.message.trim()
  ) {
    return error.message.trim();
  }
  return fallback;
}
