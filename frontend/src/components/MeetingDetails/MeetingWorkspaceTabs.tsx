import {
  getAdjacentCompactPane,
  type CompactMeetingPane,
} from '@/lib/responsive-meeting-workspace';

interface MeetingWorkspaceTabsProps {
  value: CompactMeetingPane;
  onChange: (pane: CompactMeetingPane) => void;
}

export const MEETING_PANE_IDS: Record<CompactMeetingPane, string> = {
  transcript: 'meeting-transcript-pane',
  summary: 'meeting-summary-pane',
};

const panes: Array<{ value: CompactMeetingPane; label: string }> = [
  { value: 'transcript', label: 'Transcript' },
  { value: 'summary', label: 'Summary' },
];

export function MeetingWorkspaceTabs({ value, onChange }: MeetingWorkspaceTabsProps) {
  return (
    <div
      className="absolute inset-x-3 bottom-3 z-30 mx-auto grid max-w-md grid-cols-2 gap-1 rounded-xl border border-gray-200 bg-white/95 p-1.5 shadow-lg backdrop-blur lg:hidden"
      role="group"
      aria-label="Meeting workspace"
    >
      {panes.map((pane) => (
        <button
          key={pane.value}
          type="button"
          aria-pressed={value === pane.value}
          aria-controls={MEETING_PANE_IDS[pane.value]}
          onClick={() => onChange(pane.value)}
          onKeyDown={(event) => {
            if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
            event.preventDefault();
            onChange(getAdjacentCompactPane(value, event.key));
            const switcher = event.currentTarget.closest('[role="group"]');
            const nextTab = switcher?.querySelector<HTMLButtonElement>(
              `[aria-pressed="false"]`,
            );
            nextTab?.focus();
          }}
          className={value === pane.value
            ? 'min-h-11 cursor-pointer rounded-md bg-gray-900 px-3 py-2 text-sm font-medium text-white outline-none transition-colors focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2'
            : 'min-h-11 cursor-pointer rounded-md px-3 py-2 text-sm font-medium text-gray-600 outline-none transition-colors hover:bg-gray-100 focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2'}
        >
          {pane.label}
        </button>
      ))}
    </div>
  );
}
