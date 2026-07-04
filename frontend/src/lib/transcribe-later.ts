export type TranscribeLaterStatus = 'pending' | 'imported' | 'hidden';

export interface TranscribeLaterIndexEntry {
  audioPath: string;
  sizeBytes: number;
  modifiedAtMs: number;
  status: TranscribeLaterStatus;
  updatedAtMs: number;
}

export interface TranscribeLaterRecording {
  id: string;
  title: string;
  folderPath: string;
  audioPath: string;
  sizeBytes: number;
  modifiedAtMs: number;
  status: TranscribeLaterStatus;
  indexEntry?: TranscribeLaterIndexEntry | null;
}

function isSameFileSnapshot(
  recording: TranscribeLaterRecording,
  entry: TranscribeLaterIndexEntry,
): boolean {
  return recording.audioPath === entry.audioPath
    && recording.sizeBytes === entry.sizeBytes
    && recording.modifiedAtMs === entry.modifiedAtMs;
}

export function isPendingTranscribeLaterRecording(recording: TranscribeLaterRecording): boolean {
  const entry = recording.indexEntry;
  if (!entry) {
    return recording.status === 'pending';
  }

  if (!isSameFileSnapshot(recording, entry)) {
    return true;
  }

  return entry.status === 'pending';
}

export function getTranscribeLaterTitle(recording: Pick<TranscribeLaterRecording, 'title'>): string {
  const match = recording.title.match(/^Meeting (\d{4})-(\d{2})-(\d{2})[_\s-](\d{2})-(\d{2})(?:-\d{2})?/);
  if (!match) {
    return recording.title;
  }

  const [, year, month, day, hour, minute] = match;
  return `Meeting ${year}-${month}-${day} ${hour}:${minute}`;
}
