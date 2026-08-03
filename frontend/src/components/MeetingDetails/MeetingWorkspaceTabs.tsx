import {
  getAdjacentCompactPane,
  type CompactMeetingPane,
} from '@/lib/responsive-meeting-workspace';

interface MeetingWorkspaceTabsProps {
  value: CompactMeetingPane;
  onChange: (pane: CompactMeetingPane) => void;
}

const panes: Array<{ value: CompactMeetingPane; label: string }> = [
  { value: 'transcript', label: 'Transcript' },
  { value: 'summary', label: 'Summary' },
];

export function MeetingWorkspaceTabs({ value, onChange }: MeetingWorkspaceTabsProps) {
  return (
    <div
      className="grid shrink-0 grid-cols-2 gap-1 border-b border-gray-200 bg-white p-2 lg:hidden"
      role="tablist"
      aria-label="Meeting workspace"
    >
      {panes.map((pane) => (
        <button
          key={pane.value}
          type="button"
          role="tab"
          aria-selected={value === pane.value}
          tabIndex={value === pane.value ? 0 : -1}
          onClick={() => onChange(pane.value)}
          onKeyDown={(event) => {
            if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
            event.preventDefault();
            onChange(getAdjacentCompactPane(value, event.key));
            const tabList = event.currentTarget.closest('[role="tablist"]');
            const nextTab = tabList?.querySelector<HTMLButtonElement>(
              `[role="tab"][aria-selected="false"]`,
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
