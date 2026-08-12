'use client';

import React, { createContext, useContext, useState, useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import Analytics from '@/lib/analytics';
import { invoke } from '@tauri-apps/api/core';
import { useRecordingState } from '@/contexts/RecordingStateContext';
import { toast } from 'sonner';
import { projectService } from '@/services/projectService';
import type { MeetingProjectView, Project } from '@/types/projects';
import { filterMeetingsForProjectView } from '@/lib/meeting-projects';
import type { ProjectColorKey } from '@/lib/project-colors';
import {
  isActiveSummaryJob,
  toSummaryJob,
  upsertSummaryJob,
  type SummaryBackendStatus,
  type SummaryJob,
} from '@/lib/summary-queue';


interface SidebarItem {
  id: string;
  title: string;
  type: 'folder' | 'file';
  createdAt?: string | null;
  updatedAt?: string | null;
  children?: SidebarItem[];
  projects?: Project[];
}

export interface CurrentMeeting {
  id: string;
  title: string;
  createdAt?: string | null;
  updatedAt?: string | null;
  folderPath?: string | null;
  projects?: Project[];
}

// Search result type for transcript search
interface TranscriptSearchResult {
  id: string;
  title: string;
  matchContext: string;
  timestamp: string;
};

interface SidebarContextType {
  currentMeeting: CurrentMeeting | null;
  setCurrentMeeting: (meeting: CurrentMeeting | null) => void;
  sidebarItems: SidebarItem[];
  isCollapsed: boolean;
  toggleCollapse: () => void;
  meetings: CurrentMeeting[];
  setMeetings: (meetings: CurrentMeeting[]) => void;
  isMeetingActive: boolean;
  setIsMeetingActive: (active: boolean) => void;
  handleRecordingToggle: () => void;
  searchTranscripts: (query: string) => Promise<void>;
  searchResults: TranscriptSearchResult[];
  isSearching: boolean;
  setServerAddress: (address: string) => void;
  serverAddress: string;
  transcriptServerAddress: string;
  setTranscriptServerAddress: (address: string) => void;
  summaryJobs: Record<string, SummaryJob>;
  trackSummaryJob: (response: SummaryBackendStatus) => void;
  refreshSummaryJob: (meetingId: string) => Promise<SummaryBackendStatus>;
  cancelSummaryJob: (meetingId: string, jobId: string) => Promise<void>;
  startSummaryPolling: (
    meetingId: string,
    processId: string,
    onUpdate: (result: any) => void,
  ) => void;
  // Refetch meetings from backend
  refetchMeetings: () => Promise<void>;
  projects: Project[];
  activeProjectView: MeetingProjectView;
  setActiveProjectView: (view: MeetingProjectView) => void;
  isProjectsLoading: boolean;
  projectsError: string | null;
  refetchProjects: () => Promise<void>;
  assignProject: (meetingId: string, project: Project) => Promise<void>;
  removeProject: (meetingId: string, projectId: string) => Promise<void>;
  createAndAssignProject: (meetingId: string, name: string) => Promise<Project>;
  renameProject: (projectId: string, name: string) => Promise<void>;
  updateProjectColor: (projectId: string, color: ProjectColorKey) => Promise<void>;
  deleteProject: (projectId: string) => Promise<void>;

}

const SidebarContext = createContext<SidebarContextType | null>(null);

export const useSidebar = () => {
  const context = useContext(SidebarContext);
  if (!context) {
    throw new Error('useSidebar must be used within a SidebarProvider');
  }
  return context;
};

export function SidebarProvider({ children }: { children: React.ReactNode }) {
  const [currentMeeting, setCurrentMeeting] = useState<CurrentMeeting | null>({ id: 'intro-call', title: '+ New Call' });
  const [isCollapsed, setIsCollapsed] = useState(true);
  const [meetings, setMeetings] = useState<CurrentMeeting[]>([]);
  const [sidebarItems, setSidebarItems] = useState<SidebarItem[]>([]);
  const [isMeetingActive, setIsMeetingActive] = useState(false);
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [serverAddress, setServerAddress] = useState('');
  const [transcriptServerAddress, setTranscriptServerAddress] = useState('');
  const [summaryJobs, setSummaryJobs] = useState<Record<string, SummaryJob>>({});
  const summaryPollersRef = React.useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const summaryPollsInFlightRef = React.useRef(new Set<string>());
  const summaryPollFailuresRef = React.useRef(new Map<string, number>());
  const summaryPollCallbacksRef = React.useRef(
    new Map<string, (result: any) => void>(),
  );
  const pollSummaryJobRef = React.useRef<(meetingId: string) => Promise<void>>(async () => {});
  const [projects, setProjects] = useState<Project[]>([]);
  const [activeProjectView, setActiveProjectView] = useState<MeetingProjectView>({ type: 'all' });
  const [isProjectsLoading, setIsProjectsLoading] = useState(false);
  const [projectsError, setProjectsError] = useState<string | null>(null);
  const projectColorQueues = React.useRef(new Map<string, Promise<Project>>());
  const projectColorVersions = React.useRef(new Map<string, number>());
  const projectColorIntents = React.useRef(new Map<string, string>());
  const persistedProjectColors = React.useRef(new Map<string, string>());

  // Use recording state from RecordingStateContext (single source of truth)
  const { isRecording } = useRecordingState();

  const pathname = usePathname();
  const router = useRouter();

  // Extract fetchMeetings as a reusable function
  const fetchMeetings = React.useCallback(async () => {
    if (serverAddress) {
      try {
        setMeetings(await projectService.listMeetings({ type: 'all' }));
        Analytics.trackBackendConnection(true);
      } catch (error) {
        console.error('Error fetching meetings:', error);
        setMeetings([]);
        Analytics.trackBackendConnection(false, error instanceof Error ? error.message : 'Unknown error');
      }
    }
  }, [serverAddress]);

  const fetchProjects = React.useCallback(async () => {
    if (!serverAddress) return;
    setIsProjectsLoading(true);
    try {
      setProjects(await projectService.listProjects());
      setProjectsError(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setProjectsError(message);
      toast.error('Projects could not be loaded', {
        description: 'All Meetings is still available. Try again from the project list.',
      });
    } finally {
      setIsProjectsLoading(false);
    }
  }, [serverAddress]);

  useEffect(() => {
    fetchMeetings();
  }, [serverAddress, fetchMeetings]);

  useEffect(() => {
    fetchProjects();
  }, [serverAddress, fetchProjects]);

  useEffect(() => {
    const fetchSettings = async () => {
      setServerAddress('http://localhost:5167');
      setTranscriptServerAddress('http://127.0.0.1:8178/stream');
    };
    fetchSettings();
  }, []);

  const visibleMeetings = filterMeetingsForProjectView(
    meetings.map((meeting) => ({ ...meeting, projects: meeting.projects ?? [] })),
    activeProjectView,
  );

  const baseItems: SidebarItem[] = [
    {
      id: 'meetings',
      title: 'Meeting Notes',
      type: 'folder' as const,
      children: [
        ...visibleMeetings.map(meeting => ({
          id: meeting.id,
          title: meeting.title,
          createdAt: meeting.createdAt ?? null,
          updatedAt: meeting.updatedAt ?? null,
          projects: meeting.projects ?? [],
          type: 'file' as const,
        }))
      ]
    },
  ];


  const toggleCollapse = () => {
    setIsCollapsed(!isCollapsed);
  };

  // Update current meeting when on home page
  useEffect(() => {
    if (pathname === '/') {
      setCurrentMeeting({ id: 'intro-call', title: '+ New Call' });
    }
    setSidebarItems(baseItems);
  }, [pathname]);

  // Update sidebar items when meetings change
  useEffect(() => {
    setSidebarItems(baseItems);
  }, [meetings, activeProjectView]);

  // Function to handle recording toggle from sidebar
  const handleRecordingToggle = () => {
    if (!isRecording) {
      // Check if already on home page
      if (pathname === '/') {
        // Already on home - trigger recording directly via custom event
        console.log('Triggering recording from sidebar (already on home page)');
        window.dispatchEvent(new CustomEvent('start-recording-from-sidebar'));
      } else {
        // Not on home - navigate and use auto-start mechanism
        console.log('Navigating to home page with auto-start flag');
        sessionStorage.setItem('autoStartRecording', 'true');
        router.push('/');
      }

      // Track recording initiation from sidebar
      Analytics.trackButtonClick('start_recording', 'sidebar');
    }
    // The actual recording start/stop is handled in the Home component
  };

  // Function to search through meeting transcripts
  const searchTranscripts = async (query: string) => {
    if (!query.trim()) {
      setSearchResults([]);
      return;
    }

    try {
      setIsSearching(true);


      const results = await invoke('api_search_transcripts', { query }) as TranscriptSearchResult[];
      setSearchResults(results);
    } catch (error) {
      console.error('Error searching transcripts:', error);
      setSearchResults([]);
    } finally {
      setIsSearching(false);
    }
  };

  const stopSummaryPolling = React.useCallback((meetingId: string) => {
    const timer = summaryPollersRef.current.get(meetingId);
    if (timer) clearTimeout(timer);
    summaryPollersRef.current.delete(meetingId);
    summaryPollFailuresRef.current.delete(meetingId);
  }, []);

  const ensureSummaryPolling = React.useCallback((meetingId: string, delay = 0) => {
    if (
      summaryPollersRef.current.has(meetingId)
      || summaryPollsInFlightRef.current.has(meetingId)
    ) {
      return;
    }

    const timer = setTimeout(() => {
      summaryPollersRef.current.delete(meetingId);
      void pollSummaryJobRef.current(meetingId);
    }, delay);
    summaryPollersRef.current.set(meetingId, timer);
  }, []);

  const refreshSummaryJob = React.useCallback(async (meetingId: string) => {
    const response = await invoke<SummaryBackendStatus>('api_get_summary', { meetingId });
    const job = toSummaryJob(response);
    setSummaryJobs((current) => upsertSummaryJob(current, job));
    summaryPollCallbacksRef.current.get(meetingId)?.(response);
    if (!isActiveSummaryJob(job)) summaryPollCallbacksRef.current.delete(meetingId);
    return response;
  }, []);

  pollSummaryJobRef.current = async (meetingId: string) => {
    if (summaryPollsInFlightRef.current.has(meetingId)) return;
    summaryPollsInFlightRef.current.add(meetingId);
    let nextDelay: number | null = null;

    try {
      const response = await refreshSummaryJob(meetingId);
      const job = toSummaryJob(response);
      summaryPollFailuresRef.current.delete(meetingId);
      if (isActiveSummaryJob(job)) nextDelay = 2000;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const failures = (summaryPollFailuresRef.current.get(meetingId) ?? 0) + 1;
      summaryPollFailuresRef.current.set(meetingId, failures);
      setSummaryJobs((current) => {
        const job = current[meetingId];
        return job
          ? upsertSummaryJob(current, { ...job, error: message })
          : current;
      });
      const retryDelays = [2000, 4000, 8000, 15000];
      nextDelay = retryDelays[Math.min(failures - 1, retryDelays.length - 1)];
    } finally {
      summaryPollsInFlightRef.current.delete(meetingId);
      if (nextDelay !== null) ensureSummaryPolling(meetingId, nextDelay);
    }
  };

  const trackSummaryJob = React.useCallback((response: SummaryBackendStatus) => {
    const job = toSummaryJob(response);
    setSummaryJobs((current) => upsertSummaryJob(current, job));
    if (isActiveSummaryJob(job)) ensureSummaryPolling(job.meetingId);
  }, [ensureSummaryPolling]);

  const startSummaryPolling = React.useCallback((
    meetingId: string,
    processId: string,
    onUpdate: (result: any) => void,
  ) => {
    summaryPollCallbacksRef.current.set(meetingId, onUpdate);
    trackSummaryJob({
      meeting_id: meetingId,
      process_id: processId,
      status: 'pending',
    });
  }, [trackSummaryJob]);

  const cancelSummaryJob = React.useCallback(async (meetingId: string, jobId: string) => {
    const result = await invoke<{ status: string }>('api_cancel_summary', {
      meetingId,
      processId: jobId,
    });
    setSummaryJobs((current) => {
      const active = current[meetingId];
      if (!active || active.jobId !== jobId) return current;
      return upsertSummaryJob(current, {
        ...active,
        phase: result.status === 'cancelled' ? 'cancelled' : 'cancelling',
        queuePosition: null,
        error: null,
      });
    });
    if (result.status === 'cancelling') ensureSummaryPolling(meetingId);
    else stopSummaryPolling(meetingId);
  }, [ensureSummaryPolling, stopSummaryPolling]);

  const assignProject = React.useCallback(async (meetingId: string, project: Project) => {
    const previousMeetings = meetings;
    const previousProjects = projects;
    const alreadyAssigned = meetings.find((meeting) => meeting.id === meetingId)
      ?.projects?.some((assigned) => assigned.id === project.id) ?? false;
    if (alreadyAssigned) return;

    setMeetings((current) => current.map((meeting) => meeting.id === meetingId
      ? { ...meeting, projects: [...(meeting.projects ?? []), project] }
      : meeting));
    setProjects((current) => current.map((item) => item.id === project.id
      ? { ...item, meetingCount: (item.meetingCount ?? 0) + 1 }
      : item));
    try {
      await projectService.assignMeetingProject(meetingId, project.id);
    } catch (error) {
      setMeetings(previousMeetings);
      setProjects(previousProjects);
      toast.error('Project assignment failed', {
        description: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }, [meetings, projects]);

  const removeProject = React.useCallback(async (meetingId: string, projectId: string) => {
    const previousMeetings = meetings;
    const previousProjects = projects;
    const wasAssigned = meetings.find((meeting) => meeting.id === meetingId)
      ?.projects?.some((assigned) => assigned.id === projectId) ?? false;
    if (!wasAssigned) return;

    setMeetings((current) => current.map((meeting) => meeting.id === meetingId
      ? { ...meeting, projects: (meeting.projects ?? []).filter((project) => project.id !== projectId) }
      : meeting));
    setProjects((current) => current.map((project) => project.id === projectId
      ? { ...project, meetingCount: Math.max(0, (project.meetingCount ?? 1) - 1) }
      : project));
    try {
      await projectService.removeMeetingProject(meetingId, projectId);
    } catch (error) {
      setMeetings(previousMeetings);
      setProjects(previousProjects);
      toast.error('Project removal failed', {
        description: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }, [meetings, projects]);

  const createAndAssignProject = React.useCallback(async (meetingId: string, name: string) => {
    const project = await projectService.createProject(name);
    setProjects((current) => current.some((item) => item.id === project.id)
      ? current
      : [...current, { ...project, meetingCount: 0 }].sort((a, b) => a.name.localeCompare(b.name)));
    await assignProject(meetingId, project);
    return project;
  }, [assignProject]);

  const renameProject = React.useCallback(async (projectId: string, name: string) => {
    const previousProjects = projects;
    const previousMeetings = meetings;
    setProjects((current) => current.map((project) => project.id === projectId ? { ...project, name } : project));
    setMeetings((current) => current.map((meeting) => ({
      ...meeting,
      projects: (meeting.projects ?? []).map((project) => project.id === projectId ? { ...project, name } : project),
    })));
    try {
      const renamed = await projectService.renameProject(projectId, name);
      setProjects((current) => current.map((project) => project.id === projectId
        ? { ...renamed, meetingCount: project.meetingCount }
        : project));
      setMeetings((current) => current.map((meeting) => ({
        ...meeting,
        projects: (meeting.projects ?? []).map((project) => project.id === projectId
          ? { ...renamed, meetingCount: project.meetingCount }
          : project),
      })));
    } catch (error) {
      setProjects(previousProjects);
      setMeetings(previousMeetings);
      toast.error('Project rename failed', { description: error instanceof Error ? error.message : String(error) });
      throw error;
    }
  }, [meetings, projects]);

  const updateProjectColor = React.useCallback(async (projectId: string, color: ProjectColorKey) => {
    if (!persistedProjectColors.current.has(projectId)) {
      persistedProjectColors.current.set(
        projectId,
        projects.find((project) => project.id === projectId)?.color ?? 'blue',
      );
    }
    const version = (projectColorVersions.current.get(projectId) ?? 0) + 1;
    projectColorVersions.current.set(projectId, version);
    projectColorIntents.current.set(projectId, color);
    const applyColor = (nextColor: string) => (project: Project) => project.id === projectId
      ? { ...project, color: nextColor }
      : project;
    const applyColorEverywhere = (nextColor: string) => {
      const update = applyColor(nextColor);
      setProjects((current) => current.map(update));
      setMeetings((current) => current.map((meeting) => ({
        ...meeting,
        projects: (meeting.projects ?? []).map(update),
      })));
      setCurrentMeeting((current) => current ? {
        ...current,
        projects: (current.projects ?? []).map(update),
      } : current);
    };

    applyColorEverywhere(color);
    const previousOperation = projectColorQueues.current.get(projectId);
    const operation = (previousOperation
      ? previousOperation.catch(() => undefined)
      : Promise.resolve())
      .then(() => projectService.updateColor(projectId, color));
    projectColorQueues.current.set(projectId, operation);

    try {
      const updated = await operation;
      persistedProjectColors.current.set(projectId, updated.color);
      if (projectColorVersions.current.get(projectId) === version) {
        projectColorIntents.current.set(projectId, updated.color);
        applyColorEverywhere(updated.color);
      }
    } catch (error) {
      if (projectColorVersions.current.get(projectId) === version) {
        const persistedColor = persistedProjectColors.current.get(projectId) ?? 'blue';
        projectColorIntents.current.set(projectId, persistedColor);
        applyColorEverywhere(persistedColor);
        toast.error('Project color update failed', {
          description: error instanceof Error ? error.message : String(error),
        });
      }
    } finally {
      if (projectColorQueues.current.get(projectId) === operation) {
        projectColorQueues.current.delete(projectId);
      }
    }
  }, [projects]);

  const deleteProject = React.useCallback(async (projectId: string) => {
    const previousProjects = projects;
    const previousMeetings = meetings;
    const previousActiveView = activeProjectView;
    setProjects((current) => current.filter((project) => project.id !== projectId));
    setMeetings((current) => current.map((meeting) => ({
      ...meeting,
      projects: (meeting.projects ?? []).filter((project) => project.id !== projectId),
    })));
    if (activeProjectView.type === 'project' && activeProjectView.projectId === projectId) {
      setActiveProjectView({ type: 'all' });
    }
    try {
      await projectService.deleteProject(projectId);
    } catch (error) {
      setProjects(previousProjects);
      setMeetings(previousMeetings);
      setActiveProjectView(previousActiveView);
      toast.error('Project deletion failed', { description: error instanceof Error ? error.message : String(error) });
      throw error;
    }
  }, [activeProjectView, meetings, projects]);

  // Provider lifetime owns summary polling; page navigation must not stop it.
  useEffect(() => {
    return () => {
      summaryPollersRef.current.forEach((timer) => clearTimeout(timer));
      summaryPollersRef.current.clear();
      summaryPollsInFlightRef.current.clear();
      summaryPollCallbacksRef.current.clear();
    };
  }, []);



  return (
    <SidebarContext.Provider value={{
      currentMeeting,
      setCurrentMeeting,
      sidebarItems,
      isCollapsed,
      toggleCollapse,
      meetings,
      setMeetings,
      isMeetingActive,
      setIsMeetingActive,
      handleRecordingToggle,
      searchTranscripts,
      searchResults,
      isSearching,
      setServerAddress,
      serverAddress,
      transcriptServerAddress,
      setTranscriptServerAddress,
      summaryJobs,
      trackSummaryJob,
      refreshSummaryJob,
      cancelSummaryJob,
      startSummaryPolling,
      refetchMeetings: fetchMeetings,
      projects,
      activeProjectView,
      setActiveProjectView,
      isProjectsLoading,
      projectsError,
      refetchProjects: fetchProjects,
      assignProject,
      removeProject,
      createAndAssignProject,
      renameProject,
      updateProjectColor,
      deleteProject,

    }}>
      {children}
    </SidebarContext.Provider>
  );
}
