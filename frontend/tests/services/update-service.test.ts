import { describe, expect, mock, test } from "bun:test";
import type { PreparedUpdate } from "../../src/lib/updater-flow";

mock.module("@tauri-apps/plugin-updater", () => ({
  check: async () => null,
}));
mock.module("@tauri-apps/api/app", () => ({
  getVersion: async () => "0.0.0-test",
}));

const { UpdateService } = await import("../../src/services/updateService");

describe("UpdateService", () => {
  test("returns the exact updater resource from the successful check", async () => {
    const prepared: PreparedUpdate = {
      downloadAndInstall: async () => undefined,
      close: async () => undefined,
    };
    let checks = 0;
    const service = new UpdateService(
      async () => {
        checks += 1;
        return Object.assign(prepared, {
          available: true,
          version: "0.4.11",
          date: "2026-08-13T00:00:00Z",
          body: "Updater fix",
        });
      },
      async () => "0.4.10",
    );

    const info = await service.checkForUpdates(true);

    expect(info.preparedUpdate).toBe(prepared);
    expect(info).toMatchObject({
      available: true,
      currentVersion: "0.4.10",
      version: "0.4.11",
    });
    expect(checks).toBe(1);
  });

  test("rejects a concurrent check without starting another Tauri request", async () => {
    let release!: () => void;
    const blocker = new Promise<void>((resolve) => {
      release = resolve;
    });
    let checks = 0;
    const service = new UpdateService(
      async () => {
        checks += 1;
        await blocker;
        return null;
      },
      async () => "0.4.10",
    );

    const first = service.checkForUpdates(true);
    await Promise.resolve();
    await expect(service.checkForUpdates(true)).rejects.toThrow("Update check already in progress");
    expect(checks).toBe(1);
    release();
    await first;
  });

  test("closes a superseded prepared resource", async () => {
    let closes = 0;
    const first: PreparedUpdate & { available: boolean; version: string } = {
      available: true,
      version: "0.4.11",
      downloadAndInstall: async () => undefined,
      close: async () => { closes += 1; },
    };
    const second: PreparedUpdate & { available: boolean; version: string } = {
      available: true,
      version: "0.4.12",
      downloadAndInstall: async () => undefined,
      close: async () => undefined,
    };
    const checks = [first, second];
    const service = new UpdateService(async () => checks.shift() ?? null, async () => "0.4.10");

    await service.checkForUpdates(true);
    await service.checkForUpdates(true);

    expect(closes).toBe(1);
  });

  test("shares one install gate across callers and blocks checks while installing", async () => {
    let release!: () => void;
    const blocker = new Promise<void>((resolve) => { release = resolve; });
    let operations = 0;

    const current: PreparedUpdate & { available: boolean; version: string } = {
      available: true,
      version: "0.4.11",
      downloadAndInstall: async () => undefined,
      close: async () => undefined,
    };
    const serviceWithUpdate = new UpdateService(async () => current, async () => "0.4.10");
    await serviceWithUpdate.checkForUpdates(true);

    const first = serviceWithUpdate.runUpdateOperation(current, async () => {
      operations += 1;
      await blocker;
    });
    expect(
      await serviceWithUpdate.runUpdateOperation(current, async () => { operations += 1; }),
    ).toBe(false);
    await expect(serviceWithUpdate.checkForUpdates(true)).rejects.toThrow(
      "Update installation already in progress",
    );
    expect(operations).toBe(1);
    release();
    expect(await first).toBe(true);
  });

  test("rejects a superseded resource before installation starts", async () => {
    const current: PreparedUpdate & { available: boolean; version: string } = {
      available: true,
      version: "0.4.12",
      downloadAndInstall: async () => undefined,
      close: async () => undefined,
    };
    const stale: PreparedUpdate = {
      downloadAndInstall: async () => undefined,
      close: async () => undefined,
    };
    const service = new UpdateService(async () => current, async () => "0.4.11");
    await service.checkForUpdates(true);

    await expect(service.runUpdateOperation(stale, async () => undefined)).rejects.toThrow(
      "Prepared update is stale",
    );
  });

  test("discards only the matching failed resource", async () => {
    let closes = 0;
    const prepared: PreparedUpdate & { available: boolean; version: string } = {
      available: true,
      version: "0.4.11",
      downloadAndInstall: async () => undefined,
      close: async () => { closes += 1; },
    };
    const service = new UpdateService(async () => prepared, async () => "0.4.10");
    await service.checkForUpdates(true);

    await service.discardPreparedUpdate({
      downloadAndInstall: async () => undefined,
      close: async () => undefined,
    });
    expect(closes).toBe(0);
    await service.discardPreparedUpdate(prepared);
    expect(closes).toBe(1);
  });
});
