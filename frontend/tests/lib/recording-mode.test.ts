import { describe, expect, test } from "bun:test";
import {
  getLiveTranscriptionEnabled,
  getRecordingTranscriptStatus,
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

describe("recording transcript status", () => {
  test("describes deferred transcription in Record Only mode", () => {
    expect(getRecordingTranscriptStatus(false, false)).toEqual({
      title: "Recording audio…",
      description: "Transcription will be available after you stop recording.",
      showListeningIndicator: false,
    });
  });

  test("keeps live transcription instructions when enabled", () => {
    expect(getRecordingTranscriptStatus(false, true)).toEqual({
      title: "Listening for speech...",
      description: "Speak to see live transcription",
      showListeningIndicator: true,
    });
  });

  test("keeps paused copy in either recording mode", () => {
    expect(getRecordingTranscriptStatus(true, false)).toEqual({
      title: "Recording paused",
      description: "Click resume to continue recording",
      showListeningIndicator: false,
    });
  });

  test("defaults omitted mode to live transcription for older callers", () => {
    expect(getRecordingTranscriptStatus(false)).toMatchObject({
      title: "Listening for speech...",
      showListeningIndicator: true,
    });
  });
});
