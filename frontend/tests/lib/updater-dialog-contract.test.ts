import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = readFileSync(
  resolve(import.meta.dir, "../../src/components/UpdateDialog.tsx"),
  "utf8",
);

describe("UpdateDialog updater ownership", () => {
  test("uses the prepared resource without importing the raw Tauri check", () => {
    expect(source).not.toMatch(
      /import\s*\{[^}]*\bcheck\b[^}]*\}\s*from\s*["']@tauri-apps\/plugin-updater["']/s,
    );
    expect(source).toContain("updateInfo.preparedUpdate");
    expect(source).toContain("resolvePreparedUpdate");
  });

  test("normalizes errors and guards repeated update operations", () => {
    expect(source).toContain("normalizeUpdaterError");
    expect(source).toContain("new UpdateOperationGate()");
    expect(source).toContain("Try Again");
  });
});
