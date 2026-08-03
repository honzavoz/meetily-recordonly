export type CompactMeetingPane = 'transcript' | 'summary';

export const DEFAULT_COMPACT_MEETING_PANE: CompactMeetingPane = 'summary';

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
