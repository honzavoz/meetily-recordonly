import { describe, expect, test } from "bun:test";
import {
  normalizeUpdaterError,
  resolvePreparedUpdate,
  UpdateOperationGate,
  type PreparedUpdate,
} from "../../src/lib/updater-flow";

const preparedUpdate = (): PreparedUpdate => ({
  downloadAndInstall: async () => undefined,
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
    const second = await gate.run(async () => {
      calls += 1;
    });

    expect(second).toBe(false);
    expect(calls).toBe(1);
    release();
    expect(await first).toBe(true);
    expect(
      await gate.run(async () => {
        calls += 1;
      }),
    ).toBe(true);
    expect(calls).toBe(2);
  });
});
