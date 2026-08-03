'use client';

import { X } from 'lucide-react';
import type { Project } from '@/types/projects';
import { getProjectColor } from '@/lib/project-colors';

export function ProjectChips({
  projects,
  onRemove,
}: {
  projects: Project[];
  onRemove?: (project: Project) => Promise<void> | void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5" aria-label="Assigned projects">
      {projects.map((project) => {
        const color = getProjectColor(project.color);
        return <span
          key={project.id}
          className={`group inline-flex h-7 items-center gap-1 rounded-full border px-2.5 text-xs font-semibold ${color.chipClass}`}
        >
          <span className="max-w-36 truncate">{project.name}</span>
          {onRemove && (
            <button
              type="button"
              onClick={() => onRemove(project)}
              className="-mr-1 rounded-full p-0.5 opacity-60 transition-opacity hover:bg-white/60 hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-current"
              aria-label={`Remove ${project.name} from meeting`}
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </span>;
      })}
    </div>
  );
}
