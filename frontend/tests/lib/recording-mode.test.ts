import { describe, expect, test } from "bun:test";
import {
  getLiveTranscriptionEnabled,
  shouldPersistTranscriptMeeting,
  shouldRequireTranscriptionModel,
} from "../../src/lib/recording-mode";

describe("recording mode helpers", () => {
  test("defaults old recording preferences to live transcription", () => {
    expect(getLiveTranscriptionEnabled({})).toBe(true);
    expect(shouldRequireTranscriptionModel({})).toBe(true);
  });

  test("disables model requirements when live transcription is off", () => {
    const preferences = { live_transcription_enabled: false };

    expect(getLiveTranscriptionEnabled(preferences)).toBe(false);
    expect(shouldRequireTranscriptionModel(preferences)).toBe(false);
  });

  test("only persists transcript meetings when live transcription produced transcript data", () => {
    expect(shouldPersistTranscriptMeeting(true, true, 2)).toBe(true);
    expect(shouldPersistTranscriptMeeting(true, true, 0)).toBe(false);
    expect(shouldPersistTranscriptMeeting(true, false, 2)).toBe(false);
    expect(shouldPersistTranscriptMeeting(false, true, 2)).toBe(false);
  });
});
