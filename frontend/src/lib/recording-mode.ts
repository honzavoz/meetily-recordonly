export interface RecordingModePreferences {
  live_transcription_enabled?: boolean | null;
}

export function getLiveTranscriptionEnabled(
  preferences: RecordingModePreferences | null | undefined,
): boolean {
  return preferences?.live_transcription_enabled !== false;
}

export function shouldRequireTranscriptionModel(
  preferences: RecordingModePreferences | null | undefined,
): boolean {
  return getLiveTranscriptionEnabled(preferences);
}

export function shouldPersistTranscriptMeeting(
  isCallApi: boolean,
  liveTranscriptionEnabled: boolean,
  transcriptCount: number,
): boolean {
  return isCallApi && liveTranscriptionEnabled && transcriptCount > 0;
}
