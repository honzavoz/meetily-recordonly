'use client';

import { Check } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { PROJECT_COLOR_KEYS, getProjectColor, type ProjectColorKey } from '@/lib/project-colors';
import type { Project } from '@/types/projects';

export function ProjectColorPicker({
  project,
  onChange,
}: {
  project: Project;
  onChange: (color: ProjectColorKey) => Promise<void> | void;
}) {
  const selected = getProjectColor(project.color);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="flex h-6 w-6 items-center justify-center rounded-md transition-colors hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
          aria-label={`Change color for ${project.name}`}
        >
          <span className={`h-3 w-3 rounded-full ${selected.dotClass}`} />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-44 rounded-xl p-2">
        <p className="px-1 pb-2 text-[11px] font-semibold text-gray-500">Project color</p>
        <div className="grid grid-cols-4 gap-1.5">
          {PROJECT_COLOR_KEYS.map((key) => {
            const color = getProjectColor(key);
            const active = selected.key === key;
            return (
              <button
                key={key}
                type="button"
                onClick={() => onChange(key)}
                className="relative flex h-8 items-center justify-center rounded-lg hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
                aria-label={`Set ${project.name} color to ${color.label}`}
                aria-pressed={active}
              >
                <span className={`h-5 w-5 rounded-full ring-2 ring-offset-2 ${color.swatchClass}`} />
                {active && <Check className="absolute h-3 w-3 text-white" strokeWidth={3} />}
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
