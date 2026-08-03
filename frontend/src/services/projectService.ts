import { invoke } from '@tauri-apps/api/core';
import type { MeetingProjectView, Project, ProjectMeeting } from '@/types/projects';

interface ProjectPayload {
  id: string;
  name: string;
  normalized_name: string;
  color?: string;
  created_at?: string;
  updated_at?: string;
  meeting_count?: number;
}

interface MeetingPayload {
  id: string;
  title: string;
  created_at?: string | null;
  updated_at?: string | null;
  folder_path?: string | null;
  projects?: ProjectPayload[];
}

function mapProject(project: ProjectPayload): Project {
  return {
    id: project.id,
    name: project.name,
    normalizedName: project.normalized_name,
    color: project.color ?? 'blue',
    createdAt: project.created_at,
    updatedAt: project.updated_at,
    meetingCount: project.meeting_count,
  };
}

function mapMeeting(meeting: MeetingPayload): ProjectMeeting {
  return {
    id: meeting.id,
    title: meeting.title,
    createdAt: meeting.created_at,
    updatedAt: meeting.updated_at,
    folderPath: meeting.folder_path,
    projects: (meeting.projects ?? []).map(mapProject),
  };
}

function requireName(name: string): string {
  const value = name.trim().replace(/\s+/gu, ' ');
  if (!value) throw new Error('Project name cannot be blank');
  return value;
}

export const projectService = {
  async listProjects(): Promise<Project[]> {
    return (await invoke<ProjectPayload[]>('api_list_projects')).map(mapProject);
  },

  async searchProjects(query: string): Promise<Project[]> {
    return (await invoke<ProjectPayload[]>('api_search_projects', { query })).map(mapProject);
  },

  async createProject(name: string): Promise<Project> {
    return mapProject(await invoke<ProjectPayload>('api_create_project', { name: requireName(name) }));
  },

  async renameProject(projectId: string, name: string): Promise<Project> {
    return mapProject(await invoke<ProjectPayload>('api_rename_project', {
      projectId,
      name: requireName(name),
    }));
  },

  async updateColor(projectId: string, color: string): Promise<Project> {
    return mapProject(await invoke<ProjectPayload>('api_update_project_color', {
      projectId,
      color,
    }));
  },

  async deleteProject(projectId: string): Promise<void> {
    await invoke('api_delete_project', { projectId });
  },

  async getMeetingProjects(meetingId: string): Promise<Project[]> {
    return (await invoke<ProjectPayload[]>('api_get_meeting_projects', { meetingId })).map(mapProject);
  },

  async assignMeetingProject(meetingId: string, projectId: string): Promise<void> {
    await invoke('api_assign_meeting_project', { meetingId, projectId });
  },

  async removeMeetingProject(meetingId: string, projectId: string): Promise<void> {
    await invoke('api_remove_meeting_project', { meetingId, projectId });
  },

  async listMeetings(view: MeetingProjectView): Promise<ProjectMeeting[]> {
    const payload = await invoke<MeetingPayload[]>('api_list_project_meetings', {
      view: view.type,
      projectId: view.type === 'project' ? view.projectId : null,
    });
    return payload.map(mapMeeting);
  },
};
