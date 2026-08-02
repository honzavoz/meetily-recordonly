import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  normalizeAppVersion,
  resolveAppVersion,
} from "../../src/lib/app-version.ts";

describe("application version", () => {
  test("normalizes version text for display", () => {
    assert.equal(normalizeAppVersion(" v0.4.1 "), "0.4.1");
  });

  test("uses packaged metadata when Tauri version lookup fails", async () => {
    const version = await resolveAppVersion(
      async () => {
        throw new Error("Tauri runtime unavailable");
      },
      "0.4.1",
    );

    assert.equal(version, "0.4.1");
  });

  test("prefers the runtime version in the desktop app", async () => {
    const version = await resolveAppVersion(async () => "0.4.2", "0.4.1");

    assert.equal(version, "0.4.2");
  });
});
