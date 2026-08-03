export type CompactMeetingPane = 'transcript' | 'summary';

export const DEFAULT_COMPACT_MEETING_PANE: CompactMeetingPane = 'summary';

export function getAdjacentCompactPane(
  current: CompactMeetingPane,
  key: 'ArrowLeft' | 'ArrowRight',
): CompactMeetingPane {
  const panes: CompactMeetingPane[] = ['transcript', 'summary'];
  const currentIndex = panes.indexOf(current);
  const offset = key === 'ArrowRight' ? 1 : -1;
  return panes[(currentIndex + offset + panes.length) % panes.length];
}

export type CompactSummaryAction =
  | 'external-ai'
  | 'paste-ai-result'
  | 'ai-model'
  | 'template'
  | 'copy-summary';

export function getCompactSummaryActions({
  hasSummary,
  hasTemplates,
}: {
  hasSummary: boolean;
  hasTemplates: boolean;
}): CompactSummaryAction[] {
  const actions: CompactSummaryAction[] = [
    'external-ai',
    'paste-ai-result',
    'ai-model',
  ];

  if (hasTemplates) actions.push('template');
  if (hasSummary) actions.push('copy-summary');

  return actions;
}
