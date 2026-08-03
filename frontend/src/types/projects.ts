export interface Project {
  id: string;
  name: string;
  normalizedName: string;
  color: string;
  createdAt?: string;
  updatedAt?: string;
  meetingCount?: number;
}

export interface ProjectMeeting {
  id: string;
  title: string;
  createdAt?: string | null;
  updatedAt?: string | null;
  folderPath?: string | null;
  projects: Project[];
}

export type MeetingProjectView =
  | { type: 'all' }
  | { type: 'unassigned' }
  | { type: 'project'; projectId: string };
