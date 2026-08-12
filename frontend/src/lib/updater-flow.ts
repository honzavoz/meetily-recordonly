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

export type UpdateAttemptStage = "prepare" | "install";

export class UpdateAttemptError extends Error {
  constructor(
    public readonly stage: UpdateAttemptStage,
    public readonly cause: unknown,
  ) {
    super(
      normalizeUpdaterError(
        cause,
        stage === "prepare"
          ? "Unable to prepare the update"
          : "Unable to download or install the update",
      ),
    );
    this.name = "UpdateAttemptError";
  }
}

interface RunPreparedUpdateAttemptOptions {
  info: PreparedUpdateInfo;
  localUpdate?: PreparedUpdate | null;
  retryState: PreparedUpdateRetryState;
  check: () => Promise<PreparedUpdateInfo>;
  runOperation: (
    update: PreparedUpdate,
    operation: () => Promise<void>,
  ) => Promise<boolean>;
  discard: (update: PreparedUpdate) => Promise<void>;
  onPrepared: (update: PreparedUpdate) => void;
  onEvent: (event: DownloadEvent) => void;
  onInstalled?: () => void | Promise<void>;
  relaunch: () => Promise<void>;
}

export async function runPreparedUpdateAttempt(
  options: RunPreparedUpdateAttemptOptions,
): Promise<void> {
  let preparedUpdate: PreparedUpdate;

  try {
    preparedUpdate = await resolvePreparedUpdate(
      {
        available: options.info.available,
        preparedUpdate: options.retryState.select(
          options.localUpdate ?? null,
          options.info.preparedUpdate,
        ),
      },
      options.check,
    );
  } catch (cause: unknown) {
    options.retryState.markFailed();
    throw new UpdateAttemptError("prepare", cause);
  }

  options.retryState.markPrepared(preparedUpdate);
  options.onPrepared(preparedUpdate);
  let operationEntered = false;

  try {
    const started = await options.runOperation(preparedUpdate, async () => {
      operationEntered = true;
      await preparedUpdate.downloadAndInstall(options.onEvent);
      await options.onInstalled?.();
      await options.relaunch();
    });

    if (!started) {
      throw new Error("Another update installation is already in progress");
    }
  } catch (cause: unknown) {
    if (operationEntered) {
      await options.discard(preparedUpdate);
    }
    options.retryState.markFailed();
    throw new UpdateAttemptError("install", cause);
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
