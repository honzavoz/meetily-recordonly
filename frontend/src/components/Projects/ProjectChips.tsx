'use client';

import { X } from 'lucide-react';
import type { Project } from '@/types/projects';

export function ProjectChips({
  projects,
  onRemove,
}: {
  projects: Project[];
  onRemove?: (project: Project) => Promise<void> | void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5" aria-label="Assigned projects">
      {projects.map((project) => (
        <span
          key={project.id}
          className="group inline-flex h-7 items-center gap-1 rounded-full border border-blue-100 bg-blue-50 px-2.5 text-xs font-semibold text-blue-700"
        >
          <span className="max-w-36 truncate">{project.name}</span>
          {onRemove && (
            <button
              type="button"
              onClick={() => onRemove(project)}
              className="-mr-1 rounded-full p-0.5 text-blue-400 transition-colors hover:bg-blue-100 hover:text-blue-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
              aria-label={`Remove ${project.name} from meeting`}
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </span>
      ))}
    </div>
  );
}
