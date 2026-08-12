import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = readFileSync(
  resolve(import.meta.dir, "../../src/components/UpdateDialog.tsx"),
  "utf8",
);
const aboutSource = readFileSync(
  resolve(import.meta.dir, "../../src/components/About.tsx"),
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
    expect(source).toContain("updateService.runUpdateOperation");
    expect(source).toContain("updateService.discardPreparedUpdate");
    expect(source).toContain("operationInFlightRef");
    expect(source).toContain("new PreparedUpdateRetryState()");
    expect(source).toContain("operationEntered");
    expect(source).toContain("Try Again");
    expect(aboutSource).toContain("normalizeUpdaterError(error, 'Unknown error')");
  });
});
