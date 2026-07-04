import { describe, expect, test } from "bun:test";
import {
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
  status: "pending",
  ...overrides,
});

describe("transcribe later helpers", () => {
  test("formats meeting folder names into readable titles", () => {
    expect(getTranscribeLaterTitle(recording())).toBe("Meeting 2026-07-04 17:55");
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
