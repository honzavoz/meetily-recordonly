interface RecoverableMeetingCandidate {
  transcriptCount: number;
}

export function isRecoverableTranscriptMeeting(meeting: RecoverableMeetingCandidate): boolean {
  return meeting.transcriptCount > 0;
}
