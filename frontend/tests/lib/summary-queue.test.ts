import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  applySummaryCancellationStatus,
  isActiveSummaryJob,
  toSummaryJob,
  upsertSummaryJob,
  type SummaryJob,
} from "../../src/lib/summary-queue";

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
    expect(commands).toContain("RunningSummaryJobGuard");
  });

  test("owns cancellation tokens in the queue and targets exact job IDs", () => {
    const service = tauriSource("summary/service.rs");
    const commands = tauriSource("summary/commands.rs");

    expect(service).not.toContain("CANCELLATION_REGISTRY");
    expect(service).toContain("cancellation_token: CancellationToken");
    expect(commands).toContain("process_id: Option<String>");
    expect(commands).toContain("SUMMARY_QUEUE.cancel(&meeting_id, &job_id).await");
  });

  test("keeps polling in the provider and guards duplicate requests in the meeting hook", () => {
    const provider = readFileSync(
      resolve(import.meta.dir, "../../src/components/Sidebar/SidebarProvider.tsx"),
      "utf8",
    );
    const hook = readFileSync(
      resolve(import.meta.dir, "../../src/hooks/meeting-details/useSummaryGeneration.ts"),
      "utf8",
    );
    const page = readFileSync(
      resolve(import.meta.dir, "../../src/app/meeting-details/page.tsx"),
      "utf8",
    );
    const sidebar = readFileSync(
      resolve(import.meta.dir, "../../src/components/Sidebar/index.tsx"),
      "utf8",
    );

    expect(provider).toContain("summaryPollersRef");
    expect(provider).toContain("summaryJobs: Record<string, SummaryJob>");
    expect(provider).toContain("processId: jobId");
    expect(hook).toContain("generationRequestInFlightRef");
    expect(hook).toContain("trackSummaryJob(result)");
    expect(hook).toContain("cancelSummaryJob(meeting.id, activeJob.jobId)");
    expect(hook).not.toContain("startSummaryPolling");
    expect(hook).not.toContain("stopSummaryPolling(meeting.id)");
    expect(page).not.toContain("stopSummaryPolling");
    expect(sidebar).toContain("Queued #");
    expect(sidebar).toContain("Generating");
  });
});

describe("summary generation queue frontend state", () => {
  test("maps backend pending status to a visible FIFO position", () => {
    expect(
      toSummaryJob({
        meeting_id: "b",
        process_id: "job-b",
        status: "pending",
        queue_position: 2,
      }),
    ).toEqual({
      meetingId: "b",
      jobId: "job-b",
      phase: "queued",
      queuePosition: 2,
      error: null,
    });
  });

  test("terminal updates replace only their meeting", () => {
    const initialJobs = {
      a: {
        meetingId: "a",
        jobId: "job-a",
        phase: "generating",
        queuePosition: null,
        error: null,
      },
      b: {
        meetingId: "b",
        jobId: "job-b",
        phase: "queued",
        queuePosition: 1,
        error: null,
      },
    } satisfies Record<string, SummaryJob>;
    const completedA: SummaryJob = {
      meetingId: "a",
      jobId: "job-a",
      phase: "completed",
      queuePosition: null,
      error: null,
    };

    const state = upsertSummaryJob(initialJobs, completedA);

    expect(state.a.phase).toBe("completed");
    expect(state.b).toEqual(initialJobs.b);
    expect(isActiveSummaryJob(state.a)).toBe(false);
    expect(isActiveSummaryJob(state.b)).toBe(true);
  });

  test("maps cancelling and terminal backend statuses without losing job identity", () => {
    expect(
      toSummaryJob({
        meeting_id: "a",
        process_id: "job-a",
        status: "cancelling",
      }),
    ).toMatchObject({ phase: "cancelling", jobId: "job-a" });
    expect(
      toSummaryJob({
        meeting_id: "a",
        process_id: "job-a",
        status: "failed",
        error: "provider unavailable",
      }),
    ).toMatchObject({ phase: "failed", error: "provider unavailable" });
  });

  test("a stale cancellation response does not invent a cancelling state", () => {
    const active: SummaryJob = {
      meetingId: "a",
      jobId: "job-a",
      phase: "generating",
      queuePosition: null,
      error: null,
    };

    expect(applySummaryCancellationStatus(active, "not_active")).toEqual(active);
    expect(applySummaryCancellationStatus(active, "cancelling").phase).toBe("cancelling");
    expect(applySummaryCancellationStatus(active, "cancelled").phase).toBe("cancelled");
  });
});
