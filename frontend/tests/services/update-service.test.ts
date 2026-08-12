import { describe, expect, test } from "bun:test";
import type { PreparedUpdate } from "../../src/lib/updater-flow";
import { UpdateService } from "../../src/services/updateService";

describe("UpdateService", () => {
  test("returns the exact updater resource from the successful check", async () => {
    const prepared: PreparedUpdate = { downloadAndInstall: async () => undefined };
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
});
