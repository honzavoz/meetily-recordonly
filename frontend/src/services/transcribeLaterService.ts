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

  async play(recording: TranscribeLaterRecording): Promise<void> {
    await invoke('play_transcribe_later_recording', {
      audioPath: recording.audioPath,
    });
  }

  async delete(recording: TranscribeLaterRecording): Promise<void> {
    await invoke('delete_transcribe_later_recording', {
      folderPath: recording.folderPath,
      audioPath: recording.audioPath,
    });
  }

  async rename(recording: TranscribeLaterRecording, title: string): Promise<void> {
    await invoke('rename_transcribe_later_recording', {
      folderPath: recording.folderPath,
      audioPath: recording.audioPath,
      title,
    });
  }

  async openFolder(recording: TranscribeLaterRecording): Promise<void> {
    await invoke('open_transcribe_later_recording_folder', {
      folderPath: recording.folderPath,
    });
  }
}

export const transcribeLaterService = new TranscribeLaterService();
