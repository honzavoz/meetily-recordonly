import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import type { TranscribeLaterRecording } from '@/lib/transcribe-later';
import { transcribeLaterService } from '@/services/transcribeLaterService';

export const REFRESH_TRANSCRIBE_LATER_EVENT = 'refresh-transcribe-later';
export const OPEN_TRANSCRIBE_LATER_IMPORT_EVENT = 'open-transcribe-later-import';

export interface OpenTranscribeLaterImportDetail {
  recording: TranscribeLaterRecording;
}

export function useTranscribeLaterRecordings() {
  const [recordings, setRecordings] = useState<TranscribeLaterRecording[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    try {
      const pending = await transcribeLaterService.listPending();
      setRecordings(pending);
    } catch (error) {
      console.error('Failed to load recordings pending transcription:', error);
      toast.error('Could not load To Transcribe recordings', {
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();

    const handleRefresh = () => {
      refresh();
    };

    window.addEventListener(REFRESH_TRANSCRIBE_LATER_EVENT, handleRefresh);
    return () => {
      window.removeEventListener(REFRESH_TRANSCRIBE_LATER_EVENT, handleRefresh);
    };
  }, [refresh]);

  const transcribe = useCallback((recording: TranscribeLaterRecording) => {
    window.dispatchEvent(new CustomEvent<OpenTranscribeLaterImportDetail>(
      OPEN_TRANSCRIBE_LATER_IMPORT_EVENT,
      { detail: { recording } },
    ));
  }, []);

  const hide = useCallback(async (recording: TranscribeLaterRecording) => {
    try {
      await transcribeLaterService.hide(recording);
      await refresh();
    } catch (error) {
      console.error('Failed to hide recording from To Transcribe:', error);
      toast.error('Could not hide recording', {
        description: error instanceof Error ? error.message : String(error),
      });
    }
  }, [refresh]);

  const openFolder = useCallback(async (recording: TranscribeLaterRecording) => {
    try {
      await transcribeLaterService.openFolder(recording);
    } catch (error) {
      console.error('Failed to open recording folder:', error);
      toast.error('Could not open recording folder', {
        description: error instanceof Error ? error.message : String(error),
      });
      await refresh();
    }
  }, [refresh]);

  return {
    recordings,
    isLoading,
    refresh,
    transcribe,
    hide,
    openFolder,
  };
}
