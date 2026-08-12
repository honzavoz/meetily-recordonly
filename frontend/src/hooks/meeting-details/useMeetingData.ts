import { useState, useCallback, useRef, useEffect } from 'react';
import { Transcript, Summary } from '@/types';
import { BlockNoteSummaryViewRef } from '@/components/AISummary/BlockNoteSummaryView';
import { CurrentMeeting, useSidebar } from '@/components/Sidebar/SidebarProvider';
import { invoke as invokeTauri } from '@tauri-apps/api/core';
import { toast } from 'sonner';
import {
  persistMeetingSummary,
  saveDirtyMeetingChanges,
  type SummarySaveInput,
} from '@/lib/summary-saving';

interface UseMeetingDataProps {
  meeting: any;
  summaryData: Summary | null;
  onMeetingUpdated?: () => Promise<void>;
}

export function useMeetingData({ meeting, summaryData, onMeetingUpdated }: UseMeetingDataProps) {
  // State
  // Use prop directly since summary generation fetches transcripts independently
  const transcripts = meeting.transcripts;
  const [meetingTitle, setMeetingTitle] = useState(meeting.title || '+ New Call');
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [isTitleDirty, setIsTitleDirty] = useState(false);
  const [aiSummary, setAiSummary] = useState<Summary | null>(summaryData);
  const [isSaving, setIsSaving] = useState(false);
  const [isSummaryDirty, setIsSummaryDirty] = useState(false);
  const [, setError] = useState<string>('');

  // Ref for BlockNoteSummaryView
  const blockNoteSummaryRef = useRef<BlockNoteSummaryViewRef>(null);
  const legacySummaryRevisionRef = useRef(0);

  // Sidebar context
  const { setCurrentMeeting, setMeetings, meetings: sidebarMeetings } = useSidebar();

  // Sync aiSummary state when summaryData prop changes (fixes display of fetched summaries)
  useEffect(() => {
    console.log('[useMeetingData] Syncing summary data from prop:', summaryData ? 'present' : 'null');
    setAiSummary(summaryData);
  }, [summaryData]); // Only trigger when parent prop changes, not when aiSummary changes

  // Handlers
  const handleTitleChange = useCallback((newTitle: string) => {
    setMeetingTitle(newTitle);
    setIsTitleDirty(true);
  }, []);

  const handleSummaryChange = useCallback((newSummary: Summary) => {
    legacySummaryRevisionRef.current += 1;
    setAiSummary(newSummary);
    setIsSummaryDirty(true);
  }, []);

  const handleSaveMeetingTitle = useCallback(async () => {
    try {
      await invokeTauri('api_save_meeting_title', {
        meetingId: meeting.id,
        title: meetingTitle,
      });

      console.log('Save meeting title success');
      setIsTitleDirty(false);

      // Update meetings with new title
      const updatedMeetings = sidebarMeetings.map((m: CurrentMeeting) =>
        m.id === meeting.id ? { ...m, title: meetingTitle } : m
      );
      setMeetings(updatedMeetings);
      const current = updatedMeetings.find((item) => item.id === meeting.id);
      setCurrentMeeting(current ?? { id: meeting.id, title: meetingTitle });
    } catch (error) {
      console.error('Failed to save meeting title:', error);
      if (error instanceof Error) {
        setError(error.message);
        throw error;
      } else {
        setError('Failed to save meeting title: Unknown error');
        throw new Error('Failed to save meeting title: Unknown error');
      }
    }
  }, [meeting.id, meetingTitle, sidebarMeetings, setMeetings, setCurrentMeeting]);

  const handleSaveSummary = useCallback(async (
    summary: SummarySaveInput,
    summaryRevision?: number,
  ) => {
    console.log('📄 handleSaveSummary called with:', {
      hasMarkdown: 'markdown' in summary,
      hasSummaryJson: 'summary_json' in summary,
      summaryKeys: Object.keys(summary)
    });

    const savedRevision = summaryRevision ?? legacySummaryRevisionRef.current;
    try {
      await persistMeetingSummary(meeting.id, meetingTitle, summary);
      if (savedRevision === legacySummaryRevisionRef.current) {
        setAiSummary(summary as Summary);
        setIsSummaryDirty(false);
      }

      console.log('✅ Save meeting summary success');
    } catch (error) {
      console.error('❌ Failed to save meeting summary:', error);
      if (error instanceof Error) {
        setError(error.message);
        throw error;
      } else {
        setError('Failed to save meeting summary: Unknown error');
        throw new Error('Failed to save meeting summary: Unknown error');
      }
    }
  }, [meeting.id, meetingTitle]);

  const saveAllChanges = useCallback(async () => {
    setIsSaving(true);
    try {
      const editorSummaryDirty = blockNoteSummaryRef.current?.isDirty ?? false;
      const summarySnapshot = aiSummary;
      const summarySnapshotRevision = legacySummaryRevisionRef.current;
      await saveDirtyMeetingChanges({
        isTitleDirty,
        isSummaryDirty: editorSummaryDirty || isSummaryDirty,
        saveTitle: handleSaveMeetingTitle,
        saveSummary: async () => {
          const summaryEditor = blockNoteSummaryRef.current;
          if (editorSummaryDirty && summaryEditor) {
            console.log('💾 Saving BlockNote editor changes...');
            await summaryEditor.saveSummary();
            return;
          }

          if (!summarySnapshot) {
            throw new Error('Summary content is unavailable');
          }
          await handleSaveSummary(summarySnapshot, summarySnapshotRevision);
        },
      });

      toast.success("Changes saved successfully");
    } catch (error) {
      console.error('Failed to save changes:', error);
      toast.error("Failed to save changes", { description: String(error) });
    } finally {
      setIsSaving(false);
    }
  }, [isTitleDirty, isSummaryDirty, handleSaveMeetingTitle, aiSummary, handleSaveSummary]);

  // Update meeting title from external source (e.g., AI summary)
  const updateMeetingTitle = useCallback((newTitle: string) => {
    console.log('📝 Updating meeting title to:', newTitle);
    setMeetingTitle(newTitle);
    const updatedMeetings = sidebarMeetings.map((m: CurrentMeeting) =>
      m.id === meeting.id ? { ...m, title: newTitle } : m
    );
    setMeetings(updatedMeetings);
    const current = updatedMeetings.find((item) => item.id === meeting.id);
    setCurrentMeeting(current ?? { id: meeting.id, title: newTitle });
  }, [meeting.id, sidebarMeetings, setMeetings, setCurrentMeeting]);

  return {
    // State
    transcripts,
    meetingTitle,
    isEditingTitle,
    isTitleDirty,
    aiSummary,
    isSaving,
    blockNoteSummaryRef,

    // Setters
    setMeetingTitle,
    setIsEditingTitle,
    setAiSummary,
    setIsSummaryDirty,

    // Handlers
    handleTitleChange,
    handleSummaryChange,
    handleSaveSummary,
    handleSaveMeetingTitle,
    saveAllChanges,
    updateMeetingTitle,
  };
}
