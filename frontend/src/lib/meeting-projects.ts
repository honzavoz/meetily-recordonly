import type { MeetingProjectView, ProjectMeeting } from '@/types/projects';

export function normalizeProjectName(name: string): string {
  return name.trim().replace(/\s+/gu, ' ').toLocaleLowerCase();
}

function uniqueMeetings<T extends ProjectMeeting>(meetings: T[]): T[] {
  const byId = new Map<string, T>();
  for (const meeting of meetings) {
    const existing = byId.get(meeting.id);
    if (!existing) {
      byId.set(meeting.id, meeting);
      continue;
    }
    const projects = new Map(existing.projects.map((project) => [project.id, project]));
    for (const project of meeting.projects) projects.set(project.id, project);
    byId.set(meeting.id, { ...existing, projects: [...projects.values()] });
  }
  return [...byId.values()];
}

export function sortMeetingsNewestFirst<T extends ProjectMeeting>(meetings: T[]): T[] {
  return [...meetings].sort((left, right) => {
    const leftTime = left.createdAt ? new Date(left.createdAt).getTime() : 0;
    const rightTime = right.createdAt ? new Date(right.createdAt).getTime() : 0;
    return rightTime - leftTime;
  });
}

export function filterMeetingsForProjectView<T extends ProjectMeeting>(
  meetings: T[],
  view: MeetingProjectView,
): T[] {
  const unique = uniqueMeetings(meetings);
  const filtered = unique.filter((meeting) => {
    if (view.type === 'all') return true;
    if (view.type === 'unassigned') return meeting.projects.length === 0;
    return meeting.projects.some((project) => project.id === view.projectId);
  });
  return sortMeetingsNewestFirst(filtered);
}

export function searchProjectMeetings<T extends ProjectMeeting>(meetings: T[], query: string): T[] {
  const normalizedQuery = normalizeProjectName(query);
  if (!normalizedQuery) return sortMeetingsNewestFirst(uniqueMeetings(meetings));

  return sortMeetingsNewestFirst(uniqueMeetings(meetings).filter((meeting) => {
    const createdDate = meeting.createdAt ? new Date(meeting.createdAt) : null;
    const searchable = [
      meeting.title,
      meeting.createdAt ?? '',
      createdDate && !Number.isNaN(createdDate.getTime()) ? createdDate.toLocaleString() : '',
      ...meeting.projects.map((project) => project.name),
    ].join(' ');
    return normalizeProjectName(searchable).includes(normalizedQuery);
  }));
}

export function getProjectViewCount(meetings: ProjectMeeting[], view: MeetingProjectView): number {
  return filterMeetingsForProjectView(meetings, view).length;
}
