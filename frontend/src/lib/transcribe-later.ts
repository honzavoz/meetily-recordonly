import { formatSidebarDateTime } from '@/lib/sidebar-meetings';

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
  durationSeconds?: number | null;
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

export function formatTranscribeLaterDuration(seconds?: number | null): string | null {
  if (!seconds || !Number.isFinite(seconds) || seconds <= 0) {
    return null;
  }

  const totalSeconds = Math.round(seconds);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const remainingSeconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(remainingSeconds).padStart(2, '0')}`;
  }

  return `${minutes}:${String(remainingSeconds).padStart(2, '0')}`;
}

export function formatTranscribeLaterSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return '0 B';
  }

  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  if (unitIndex === 0) {
    return `${Math.round(value)} ${units[unitIndex]}`;
  }

  return `${value.toFixed(1)} ${units[unitIndex]}`;
}

export function getTranscribeLaterSubtitle(
  recording: Pick<TranscribeLaterRecording, 'durationSeconds' | 'sizeBytes' | 'modifiedAtMs'>,
): string {
  const parts = [
    formatTranscribeLaterDuration(recording.durationSeconds),
    formatTranscribeLaterSize(recording.sizeBytes),
    formatSidebarDateTime(recording.modifiedAtMs),
  ].filter((part): part is string => Boolean(part));

  return parts.join(' • ');
}

export function filterTranscribeLaterRecordings(
  recordings: TranscribeLaterRecording[],
  query: string,
): TranscribeLaterRecording[] {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) {
    return recordings;
  }

  return recordings.filter((recording) => {
    const searchableText = [
      getTranscribeLaterTitle(recording),
      getTranscribeLaterSubtitle(recording),
      recording.title,
    ].join(' ').toLowerCase();

    return searchableText.includes(normalizedQuery);
  });
}

export function getTranscribeLaterDeleteConfirmationText(
  recording: Pick<TranscribeLaterRecording, 'title'> | null | undefined,
): string {
  const title = recording ? getTranscribeLaterTitle(recording) : 'this recording';
  return `Delete "${title}"? This will remove the audio, metadata, and any saved files for this record-only meeting.`;
}
