import { invoke } from '@tauri-apps/api/core';
import type { TranscribeLaterRecording } from '@/lib/transcribe-later';

export class TranscribeLaterService {
  async listPending(): Promise<TranscribeLaterRecording[]> {
    return invoke<TranscribeLaterRecording[]>('list_pending_recordings_to_transcribe');
  }

  async markTranscribed(recording: TranscribeLaterRecording): Promise<void> {
    await invoke('mark_recording_transcribed', {
      audioPath: recording.audioPath,
      sizeBytes: recording.sizeBytes,
      modifiedAtMs: recording.modifiedAtMs,
    });
  }

  async hide(recording: TranscribeLaterRecording): Promise<void> {
    await invoke('hide_recording_from_transcribe_later', {
      audioPath: recording.audioPath,
      sizeBytes: recording.sizeBytes,
      modifiedAtMs: recording.modifiedAtMs,
    });
  }

  async openFolder(recording: TranscribeLaterRecording): Promise<void> {
    await invoke('open_transcribe_later_recording_folder', {
      folderPath: recording.folderPath,
    });
  }
}

export const transcribeLaterService = new TranscribeLaterService();
