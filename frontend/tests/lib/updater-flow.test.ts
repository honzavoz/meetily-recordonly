import { describe, expect, test } from "bun:test";
import {
  normalizeUpdaterError,
  PreparedUpdateRetryState,
  runPreparedUpdateAttempt,
  resolvePreparedUpdate,
  UpdateOperationGate,
  type PreparedUpdate,
} from "../../src/lib/updater-flow";

const preparedUpdate = (): PreparedUpdate => ({
  downloadAndInstall: async () => undefined,
  close: async () => undefined,
});

describe("normalizeUpdaterError", () => {
  test("preserves string and Error messages", () => {
    expect(normalizeUpdaterError("network unavailable", "fallback")).toBe("network unavailable");
    expect(normalizeUpdaterError(new Error("signature mismatch"), "fallback")).toBe(
      "signature mismatch",
    );
  });

  test("reads object messages and falls back for unknown values", () => {
    expect(normalizeUpdaterError({ message: "resource closed" }, "fallback")).toBe(
      "resource closed",
    );
    expect(normalizeUpdaterError({ code: 500 }, "fallback")).toBe("fallback");
    expect(normalizeUpdaterError("   ", "fallback")).toBe("fallback");
  });
});

describe("resolvePreparedUpdate", () => {
  test("returns the original prepared resource without refreshing", async () => {
    const original = preparedUpdate();
    let refreshCalls = 0;

    const result = await resolvePreparedUpdate(
      { available: true, preparedUpdate: original },
      async () => {
        refreshCalls += 1;
        return { available: true, preparedUpdate: preparedUpdate() };
      },
    );

    expect(result).toBe(original);
    expect(refreshCalls).toBe(0);
  });

  test("performs one fallback refresh when the resource is missing", async () => {
    const replacement = preparedUpdate();
    let refreshCalls = 0;

    const result = await resolvePreparedUpdate(
      { available: true },
      async () => {
        refreshCalls += 1;
        return { available: true, preparedUpdate: replacement };
      },
    );

    expect(result).toBe(replacement);
    expect(refreshCalls).toBe(1);
  });

  test("rejects a refresh that no longer has an update", async () => {
    expect(
      resolvePreparedUpdate({ available: true }, async () => ({ available: false })),
    ).rejects.toThrow("Update is no longer available");
  });
});

describe("UpdateOperationGate", () => {
  test("starts only one operation until the first one settles", async () => {
    const gate = new UpdateOperationGate();
    let release!: () => void;
    const blocker = new Promise<void>((resolve) => {
      release = resolve;
    });
    let calls = 0;

    const first = gate.run(async () => {
      calls += 1;
      await blocker;
    });
    expect(gate.isRunning).toBe(true);
    const second = await gate.run(async () => {
      calls += 1;
    });

    expect(second).toBe(false);
    expect(calls).toBe(1);
    release();
    expect(await first).toBe(true);
    expect(gate.isRunning).toBe(false);
    expect(
      await gate.run(async () => {
        calls += 1;
      }),
    ).toBe(true);
    expect(calls).toBe(2);
  });
});

describe("PreparedUpdateRetryState", () => {
  test("forces one fresh preparation after a failed resource", () => {
    const retry = new PreparedUpdateRetryState();
    const stale = preparedUpdate();
    const replacement = preparedUpdate();

    expect(retry.select(stale, stale)).toBe(stale);
    retry.markFailed();
    expect(retry.select(null, stale)).toBeUndefined();
    retry.markPrepared(replacement);
    expect(retry.select(replacement, stale)).toBe(replacement);
  });
});

describe("runPreparedUpdateAttempt", () => {
  test("installs the provided resource without another check and relaunches", async () => {
    const events: string[] = [];
    const prepared: PreparedUpdate = {
      close: async () => undefined,
      downloadAndInstall: async (onEvent) => {
        onEvent?.({ event: "Started", data: { contentLength: 10 } });
        onEvent?.({ event: "Finished" });
      },
    };
    let checks = 0;
    let relaunches = 0;

    await runPreparedUpdateAttempt({
      info: { available: true, preparedUpdate: prepared },
      retryState: new PreparedUpdateRetryState(),
      check: async () => { checks += 1; return { available: false }; },
      runOperation: async (update, operation) => {
        expect(update).toBe(prepared);
        await operation();
        return true;
      },
      discard: async () => undefined,
      onPrepared: (update) => expect(update).toBe(prepared),
      onEvent: (event) => events.push(event.event),
      relaunch: async () => { relaunches += 1; },
    });

    expect(checks).toBe(0);
    expect(events).toEqual(["Started", "Finished"]);
    expect(relaunches).toBe(1);
  });

  test("discards a failed resource and forces a fresh resource on retry", async () => {
    let closes = 0;
    let staleDownloads = 0;
    let replacementDownloads = 0;
    let checks = 0;
    const stale: PreparedUpdate = {
      close: async () => { closes += 1; },
      downloadAndInstall: async () => {
        staleDownloads += 1;
        throw "resource closed";
      },
    };
    const replacement: PreparedUpdate = {
      close: async () => undefined,
      downloadAndInstall: async () => { replacementDownloads += 1; },
    };
    const retryState = new PreparedUpdateRetryState();
    let current: PreparedUpdate = stale;
    const options = {
      info: { available: true, preparedUpdate: stale },
      retryState,
      check: async () => {
        checks += 1;
        current = replacement;
        return { available: true, preparedUpdate: replacement };
      },
      runOperation: async (update: PreparedUpdate, operation: () => Promise<void>) => {
        if (update !== current) throw new Error("Prepared update is stale");
        await operation();
        return true;
      },
      discard: async (update: PreparedUpdate) => {
        if (update === current) {
          await update.close();
        }
      },
      onPrepared: () => undefined,
      onEvent: () => undefined,
      relaunch: async () => undefined,
    };

    await expect(runPreparedUpdateAttempt(options)).rejects.toMatchObject({ stage: "install" });
    await runPreparedUpdateAttempt(options);

    expect(staleDownloads).toBe(1);
    expect(replacementDownloads).toBe(1);
    expect(closes).toBe(1);
    expect(checks).toBe(1);
  });

  test("does not report installation success when relaunch fails", async () => {
    const prepared = preparedUpdate();
    let successCallbacks = 0;
    let discards = 0;

    await expect(
      runPreparedUpdateAttempt({
        info: { available: true, preparedUpdate: prepared },
        retryState: new PreparedUpdateRetryState(),
        check: async () => ({ available: false }),
        runOperation: async (_update, operation) => {
          await operation();
          return true;
        },
        discard: async () => { discards += 1; },
        onPrepared: () => undefined,
        onEvent: () => undefined,
        onInstalled: () => { successCallbacks += 1; },
        relaunch: async () => { throw new Error("restart denied"); },
      }),
    ).rejects.toMatchObject({ stage: "install", cause: new Error("restart denied") });

    expect(successCallbacks).toBe(0);
    expect(discards).toBe(1);
  });
});
