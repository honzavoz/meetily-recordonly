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

  test("reserves a unique job before resetting SQLite", () => {
    const commands = tauriSource("summary/commands.rs");
    const reserve = commands.indexOf("SUMMARY_QUEUE.reserve(&m_id).await");
    const reset = commands.indexOf("create_or_reset_process", reserve);

    expect(reserve).toBeGreaterThan(-1);
    expect(reset).toBeGreaterThan(reserve);
    expect(commands).toContain("already_active");
    expect(commands).toContain("queue_position");
    expect(commands).toMatch(/wait_for_turn\(&job_id(?:_clone)?, &token\)/);
  });

  test("owns cancellation tokens in the queue and targets exact job IDs", () => {
    const service = tauriSource("summary/service.rs");
    const commands = tauriSource("summary/commands.rs");

    expect(service).not.toContain("CANCELLATION_REGISTRY");
    expect(service).toContain("cancellation_token: CancellationToken");
    expect(commands).toContain("process_id: Option<String>");
    expect(commands).toContain("SUMMARY_QUEUE.cancel(&meeting_id, &job_id).await");
  });
});
