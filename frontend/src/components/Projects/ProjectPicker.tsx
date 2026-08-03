'use client';

import { useMemo, useState } from 'react';
import { Check, Plus } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { normalizeProjectName } from '@/lib/meeting-projects';
import type { Project } from '@/types/projects';
import { getProjectColor } from '@/lib/project-colors';

interface ProjectPickerProps {
  projects: Project[];
  assignedProjectIds?: string[];
  onSelect: (project: Project) => Promise<void> | void;
  onCreate: (name: string) => Promise<unknown> | void;
  label?: string;
  compact?: boolean;
}

export function ProjectPicker({
  projects,
  assignedProjectIds = [],
  onSelect,
  onCreate,
  label = 'Add project',
  compact = false,
}: ProjectPickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [pending, setPending] = useState(false);
  const assigned = useMemo(() => new Set(assignedProjectIds), [assignedProjectIds]);
  const normalizedQuery = normalizeProjectName(query);
  const exactMatch = projects.some((project) => project.normalizedName === normalizedQuery);

  const finish = async (action: () => Promise<unknown> | void) => {
    setPending(true);
    try {
      await action();
      setOpen(false);
      setQuery('');
    } finally {
      setPending(false);
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={compact
            ? 'inline-flex h-7 items-center gap-1 rounded-md border border-gray-200 bg-white px-2 text-xs font-medium text-gray-600 shadow-sm transition-colors hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400'
            : 'inline-flex h-8 items-center gap-1.5 rounded-full border border-dashed border-gray-300 bg-white px-3 text-xs font-semibold text-gray-600 transition-colors hover:border-blue-400 hover:bg-blue-50 hover:text-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400'}
          aria-label={label}
        >
          <Plus className="h-3.5 w-3.5" />
          {label}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 overflow-hidden rounded-xl border-gray-200 p-0 shadow-xl">
        <Command shouldFilter>
          <CommandInput
            value={query}
            onValueChange={setQuery}
            placeholder="Find or create a project"
            disabled={pending}
          />
          <CommandList className="max-h-64 p-1">
            <CommandEmpty className="px-3 py-4 text-left text-xs text-gray-500">
              No matching projects
            </CommandEmpty>
            <CommandGroup heading="Projects">
              {projects.map((project) => {
                const isAssigned = assigned.has(project.id);
                const color = getProjectColor(project.color);
                return (
                  <CommandItem
                    key={project.id}
                    value={`${project.name} ${project.normalizedName}`}
                    disabled={pending || isAssigned}
                    onSelect={() => finish(() => onSelect(project))}
                    className="rounded-lg py-2"
                  >
                    <span className={`h-3 w-3 rounded-full ${color.dotClass}`} />
                    <span className="min-w-0 flex-1 truncate">{project.name}</span>
                    {isAssigned && <Check className="h-4 w-4 text-emerald-600" />}
                    {!isAssigned && project.meetingCount !== undefined && (
                      <span className="text-[11px] tabular-nums text-gray-400">{project.meetingCount}</span>
                    )}
                  </CommandItem>
                );
              })}
            </CommandGroup>
            {normalizedQuery && !exactMatch && (
              <CommandGroup heading="Create">
                <CommandItem
                  value={`create ${query}`}
                  disabled={pending}
                  onSelect={() => finish(() => onCreate(query))}
                  className="rounded-lg bg-blue-50 py-2 text-blue-700 data-[selected=true]:bg-blue-100"
                >
                  <Plus className="h-4 w-4" />
                  <span className="truncate">Create “{query.trim().replace(/\s+/gu, ' ')}”</span>
                </CommandItem>
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
