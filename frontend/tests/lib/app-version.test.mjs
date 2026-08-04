import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { readFileSync } from "node:fs";

import {
  normalizeAppVersion,
  resolveAppVersion,
} from "../../src/lib/app-version.ts";

describe("application version", () => {
  test("packages Meetily 0.4.7 without changing its bundle identity", () => {
    const tauriConfig = JSON.parse(readFileSync(new URL("../../src-tauri/tauri.conf.json", import.meta.url), "utf8"));
    const packageJson = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8"));
    const cargoToml = readFileSync(new URL("../../src-tauri/Cargo.toml", import.meta.url), "utf8");

    assert.equal(tauriConfig.productName, "Meetily");
    assert.equal(tauriConfig.app.windows[0].title, "Meetily");
    assert.equal(tauriConfig.identifier, "cz.honzavoz.meetily.recordonly");
    assert.equal(tauriConfig.version, "0.4.7");
    assert.equal(packageJson.version, "0.4.7");
    assert.match(cargoToml, /^version = "0\.4\.7"$/m);
  });

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
