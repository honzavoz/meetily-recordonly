export const PROJECT_COLOR_KEYS = [
  'blue',
  'violet',
  'emerald',
  'amber',
  'rose',
  'cyan',
  'orange',
  'slate',
] as const;

export type ProjectColorKey = (typeof PROJECT_COLOR_KEYS)[number];

export interface ProjectColorStyle {
  key: ProjectColorKey;
  label: string;
  chipClass: string;
  dotClass: string;
  swatchClass: string;
}

const PROJECT_COLORS: Record<ProjectColorKey, ProjectColorStyle> = {
  blue: {
    key: 'blue', label: 'Blue',
    chipClass: 'border-blue-200 bg-blue-50 text-blue-700',
    dotClass: 'bg-blue-500', swatchClass: 'bg-blue-500 ring-blue-200',
  },
  violet: {
    key: 'violet', label: 'Violet',
    chipClass: 'border-violet-200 bg-violet-50 text-violet-700',
    dotClass: 'bg-violet-500', swatchClass: 'bg-violet-500 ring-violet-200',
  },
  emerald: {
    key: 'emerald', label: 'Emerald',
    chipClass: 'border-emerald-200 bg-emerald-50 text-emerald-700',
    dotClass: 'bg-emerald-500', swatchClass: 'bg-emerald-500 ring-emerald-200',
  },
  amber: {
    key: 'amber', label: 'Amber',
    chipClass: 'border-amber-200 bg-amber-50 text-amber-800',
    dotClass: 'bg-amber-500', swatchClass: 'bg-amber-500 ring-amber-200',
  },
  rose: {
    key: 'rose', label: 'Rose',
    chipClass: 'border-rose-200 bg-rose-50 text-rose-700',
    dotClass: 'bg-rose-500', swatchClass: 'bg-rose-500 ring-rose-200',
  },
  cyan: {
    key: 'cyan', label: 'Cyan',
    chipClass: 'border-cyan-200 bg-cyan-50 text-cyan-800',
    dotClass: 'bg-cyan-500', swatchClass: 'bg-cyan-500 ring-cyan-200',
  },
  orange: {
    key: 'orange', label: 'Orange',
    chipClass: 'border-orange-200 bg-orange-50 text-orange-800',
    dotClass: 'bg-orange-500', swatchClass: 'bg-orange-500 ring-orange-200',
  },
  slate: {
    key: 'slate', label: 'Slate',
    chipClass: 'border-slate-200 bg-slate-100 text-slate-700',
    dotClass: 'bg-slate-500', swatchClass: 'bg-slate-500 ring-slate-200',
  },
};

export function getProjectColor(color?: string | null): ProjectColorStyle {
  return PROJECT_COLORS[color as ProjectColorKey] ?? PROJECT_COLORS.blue;
}
