import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const tauriSource = (path: string) =>
  readFileSync(resolve(import.meta.dir, `../../src-tauri/src/${path}`), "utf8");

describe("summary generation queue backend contracts", () => {
  test("recovers interrupted jobs before every database becomes active", () => {
    const setup = tauriSource("database/setup.rs");
    const commands = tauriSource("database/commands.rs");

    expect(setup).toContain("recover_interrupted_processes(db_manager.pool())");
    expect(commands.match(/recover_interrupted_processes\(db_manager\.pool\(\)\)/g)).toHaveLength(2);
    expect(commands.indexOf("recover_interrupted_processes(db_manager.pool())")).toBeLessThan(
      commands.indexOf('emit("database-initialized"'),
    );
  });
});
