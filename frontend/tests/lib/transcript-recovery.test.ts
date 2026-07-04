import { describe, expect, test } from "bun:test";
import { isRecoverableTranscriptMeeting } from "../../src/lib/transcript-recovery";

describe("transcript recovery helpers", () => {
  test("does not offer zero-transcript record-only meetings for recovery", () => {
    expect(
      isRecoverableTranscriptMeeting({
        meetingId: "meeting-1",
        title: "Meeting 2026-07-04_17-55-31",
        startTime: Date.now() - 60_000,
        lastUpdated: Date.now() - 60_000,
        transcriptCount: 0,
        savedToSQLite: false,
      }),
    ).toBe(false);
  });

  test("offers interrupted meetings with transcripts for recovery", () => {
    expect(
      isRecoverableTranscriptMeeting({
        meetingId: "meeting-2",
        title: "Meeting with live transcript",
        startTime: Date.now() - 60_000,
        lastUpdated: Date.now() - 60_000,
        transcriptCount: 3,
        savedToSQLite: false,
      }),
    ).toBe(true);
  });
});
