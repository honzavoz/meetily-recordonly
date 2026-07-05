import { describe, expect, test } from "bun:test";
import {
  filterTranscribeLaterRecordings,
  formatTranscribeLaterDuration,
  getTranscribeLaterDeleteConfirmationText,
  getTranscribeLaterSubtitle,
  getTranscribeLaterTitle,
  isPendingTranscribeLaterRecording,
  type TranscribeLaterIndexEntry,
  type TranscribeLaterRecording,
} from "@/lib/transcribe-later";

const recording = (
  overrides: Partial<TranscribeLaterRecording> = {},
): TranscribeLaterRecording => ({
  id: "/recordings/Meeting 2026-07-04_17-55-31/Meeting 2026-07-04_17-55-31.mp4",
  title: "Meeting 2026-07-04_17-55-31",
  folderPath: "/recordings/Meeting 2026-07-04_17-55-31",
  audioPath: "/recordings/Meeting 2026-07-04_17-55-31/Meeting 2026-07-04_17-55-31.mp4",
  sizeBytes: 1200,
  modifiedAtMs: 1_788_017_731_000,
  durationSeconds: null,
  status: "pending",
  ...overrides,
});

describe("transcribe later helpers", () => {
  test("formats meeting folder names into readable titles", () => {
    expect(getTranscribeLaterTitle(recording())).toBe("Meeting 2026-07-04 17:55");
  });

  test("formats recording duration for the sidebar", () => {
    expect(formatTranscribeLaterDuration(65)).toBe("1:05");
    expect(formatTranscribeLaterDuration(3661)).toBe("1:01:01");
    expect(formatTranscribeLaterDuration(null)).toBeNull();
  });

  test("shows duration and file size in the sidebar subtitle", () => {
    expect(getTranscribeLaterSubtitle(recording({ durationSeconds: 754, sizeBytes: 4_407_706 }))).toBe("12:34 • 4.2 MB");
    expect(getTranscribeLaterSubtitle(recording({ durationSeconds: null, sizeBytes: 154_112 }))).toBe("150.5 KB");
  });

  test("filters recordings by title and subtitle", () => {
    const clientKickoff = recording({
      title: "Client kickoff",
      sizeBytes: 4_407_706,
      durationSeconds: 754,
    });
    const planning = recording({
      id: "/recordings/Planning/audio.mp4",
      title: "Planning",
      folderPath: "/recordings/Planning",
      audioPath: "/recordings/Planning/audio.mp4",
      sizeBytes: 154_112,
    });

    expect(filterTranscribeLaterRecordings([clientKickoff, planning], "kick")).toEqual([clientKickoff]);
    expect(filterTranscribeLaterRecordings([clientKickoff, planning], "150.5")).toEqual([planning]);
    expect(filterTranscribeLaterRecordings([clientKickoff, planning], "   ")).toEqual([clientKickoff, planning]);
  });

  test("includes the recording title in delete confirmation text", () => {
    expect(getTranscribeLaterDeleteConfirmationText(recording({ title: "Client kickoff" }))).toContain('"Client kickoff"');
  });

  test("keeps pending recordings visible", () => {
    expect(isPendingTranscribeLaterRecording(recording())).toBe(true);
  });

  test("hides imported and hidden recordings when the file is unchanged", () => {
    const imported: TranscribeLaterIndexEntry = {
      audioPath: recording().audioPath,
      sizeBytes: recording().sizeBytes,
      modifiedAtMs: recording().modifiedAtMs,
      status: "imported",
      updatedAtMs: 1_788_017_800_000,
    };

    const hidden: TranscribeLaterIndexEntry = {
      ...imported,
      status: "hidden",
    };

    expect(isPendingTranscribeLaterRecording(recording({ indexEntry: imported }))).toBe(false);
    expect(isPendingTranscribeLaterRecording(recording({ indexEntry: hidden }))).toBe(false);
  });

  test("shows an imported recording again when the audio file changes", () => {
    const staleImported: TranscribeLaterIndexEntry = {
      audioPath: recording().audioPath,
      sizeBytes: 900,
      modifiedAtMs: recording().modifiedAtMs - 10_000,
      status: "imported",
      updatedAtMs: 1_788_017_800_000,
    };

    expect(isPendingTranscribeLaterRecording(recording({ indexEntry: staleImported }))).toBe(true);
  });
});
