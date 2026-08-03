'use client';

import { Folder, Inbox, Layers3, Pencil, RotateCw, Trash2 } from 'lucide-react';
import type { MeetingProjectView, Project, ProjectMeeting } from '@/types/projects';
import { getProjectViewCount } from '@/lib/meeting-projects';

export function ProjectSidebarNavigation({
  meetings,
  projects,
  activeView,
  loading,
  error,
  onSelect,
  onRetry,
  onRename,
  onDelete,
}: {
  meetings: ProjectMeeting[];
  projects: Project[];
  activeView: MeetingProjectView;
  loading: boolean;
  error: string | null;
  onSelect: (view: MeetingProjectView) => void;
  onRetry: () => void;
  onRename: (project: Project) => void;
  onDelete: (project: Project) => void;
}) {
  const rowClass = (active: boolean) => `group flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 ${active ? 'bg-blue-50 font-semibold text-blue-700' : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'}`;

  return (
    <nav className="mx-1 mt-2 space-y-0.5" aria-label="Meeting project views">
      <button className={rowClass(activeView.type === 'all')} onClick={() => onSelect({ type: 'all' })}>
        <Layers3 className="h-3.5 w-3.5" />
        <span className="flex-1">All Meetings</span>
        <span className="text-[11px] tabular-nums text-gray-400">{getProjectViewCount(meetings, { type: 'all' })}</span>
      </button>
      <button className={rowClass(activeView.type === 'unassigned')} onClick={() => onSelect({ type: 'unassigned' })}>
        <Inbox className="h-3.5 w-3.5" />
        <span className="flex-1">Unassigned</span>
        <span className="text-[11px] tabular-nums text-gray-400">{getProjectViewCount(meetings, { type: 'unassigned' })}</span>
      </button>

      <div className="flex items-center px-2 pb-0.5 pt-2 text-[10px] font-bold uppercase tracking-[0.14em] text-gray-400">
        <span className="flex-1">Projects</span>
        {loading && <RotateCw className="h-3 w-3 animate-spin" />}
      </div>

      {error && (
        <button onClick={onRetry} className="flex w-full items-center gap-2 rounded-md border border-amber-100 bg-amber-50 px-2 py-1.5 text-left text-xs text-amber-800">
          <RotateCw className="h-3.5 w-3.5" />
          Retry projects
        </button>
      )}

      {!error && !loading && projects.length === 0 && (
        <p className="px-2 py-1 text-xs text-gray-400">Create a project while assigning a meeting.</p>
      )}

      {projects.map((project) => (
        <div key={project.id} className="group/project flex items-center">
          <button
            className={`${rowClass(activeView.type === 'project' && activeView.projectId === project.id)} min-w-0 flex-1`}
            onClick={() => onSelect({ type: 'project', projectId: project.id })}
          >
            <Folder className="h-3.5 w-3.5" />
            <span className="min-w-0 flex-1 truncate">{project.name}</span>
            <span className="text-[11px] tabular-nums text-gray-400">{project.meetingCount ?? 0}</span>
          </button>
          <div className="hidden items-center group-hover/project:flex group-focus-within/project:flex">
            <button className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-blue-600" onClick={() => onRename(project)} aria-label={`Rename ${project.name}`}>
              <Pencil className="h-3 w-3" />
            </button>
            <button className="rounded p-1 text-gray-400 hover:bg-red-50 hover:text-red-600" onClick={() => onDelete(project)} aria-label={`Delete ${project.name}`}>
              <Trash2 className="h-3 w-3" />
            </button>
          </div>
        </div>
      ))}
    </nav>
  );
}
