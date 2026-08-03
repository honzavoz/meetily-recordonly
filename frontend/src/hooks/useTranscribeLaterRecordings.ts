import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import type { TranscribeLaterRecording } from '@/lib/transcribe-later';
import { transcribeLaterService } from '@/services/transcribeLaterService';
import { projectService } from '@/services/projectService';
import type { Project } from '@/types/projects';

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

  const play = useCallback(async (recording: TranscribeLaterRecording) => {
    try {
      await transcribeLaterService.play(recording);
    } catch (error) {
      console.error('Failed to play recording:', error);
      toast.error('Could not play recording', {
        description: error instanceof Error ? error.message : String(error),
      });
      await refresh();
    }
  }, [refresh]);

  const deleteRecording = useCallback(async (recording: TranscribeLaterRecording) => {
    try {
      await transcribeLaterService.delete(recording);
      toast.success('Recording deleted');
      await refresh();
    } catch (error) {
      console.error('Failed to delete recording:', error);
      toast.error('Could not delete recording', {
        description: error instanceof Error ? error.message : String(error),
      });
      await refresh();
    }
  }, [refresh]);

  const rename = useCallback(async (recording: TranscribeLaterRecording, title: string) => {
    try {
      await transcribeLaterService.rename(recording, title);
      toast.success('Recording renamed');
      await refresh();
      return true;
    } catch (error) {
      console.error('Failed to rename recording:', error);
      toast.error('Could not rename recording', {
        description: error instanceof Error ? error.message : String(error),
      });
      await refresh();
      return false;
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

  const updateRecordingProjects = useCallback((recordingId: string, projects: Project[]) => {
    setRecordings((current) => current.map((recording) => recording.id === recordingId
      ? { ...recording, projects }
      : recording));
  }, []);

  const assignProject = useCallback(async (
    recording: TranscribeLaterRecording,
    project: Project,
  ) => {
    if ((recording.projects ?? []).some((assigned) => assigned.id === project.id)) return;
    const previousProjects = recording.projects ?? [];
    updateRecordingProjects(recording.id, [...previousProjects, project]);
    try {
      updateRecordingProjects(
        recording.id,
        await transcribeLaterService.assignProject(recording, project.id),
      );
    } catch (error) {
      updateRecordingProjects(recording.id, previousProjects);
      toast.error('Project assignment failed', {
        description: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }, [updateRecordingProjects]);

  const removeProject = useCallback(async (
    recording: TranscribeLaterRecording,
    projectId: string,
  ) => {
    const previousProjects = recording.projects ?? [];
    if (!previousProjects.some((project) => project.id === projectId)) return;
    updateRecordingProjects(
      recording.id,
      previousProjects.filter((project) => project.id !== projectId),
    );
    try {
      updateRecordingProjects(
        recording.id,
        await transcribeLaterService.removeProject(recording, projectId),
      );
    } catch (error) {
      updateRecordingProjects(recording.id, previousProjects);
      toast.error('Project removal failed', {
        description: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }, [updateRecordingProjects]);

  const createAndAssignProject = useCallback(async (
    recording: TranscribeLaterRecording,
    name: string,
  ) => {
    const project = await projectService.createProject(name);
    await assignProject(recording, project);
    return project;
  }, [assignProject]);

  return {
    recordings,
    isLoading,
    refresh,
    transcribe,
    hide,
    play,
    deleteRecording,
    rename,
    openFolder,
    assignProject,
    removeProject,
    createAndAssignProject,
  };
}
