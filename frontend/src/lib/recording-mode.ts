export interface RecordingModePreferences {
  live_transcription_enabled?: boolean | null;
}

export interface RecordingTranscriptStatus {
  title: string;
  description: string;
  showListeningIndicator: boolean;
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

export function getRecordingTranscriptStatus(
  isPaused: boolean,
  liveTranscriptionEnabled = true,
): RecordingTranscriptStatus {
  if (isPaused) {
    return {
      title: 'Recording paused',
      description: 'Click resume to continue recording',
      showListeningIndicator: false,
    };
  }

  if (!liveTranscriptionEnabled) {
    return {
      title: 'Recording audio…',
      description: 'Transcription will be available after you stop recording.',
      showListeningIndicator: false,
    };
  }

  return {
    title: 'Listening for speech...',
    description: 'Speak to see live transcription',
    showListeningIndicator: true,
  };
}
