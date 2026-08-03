import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import {
  DEFAULT_COMPACT_MEETING_PANE,
  getAdjacentCompactPane,
  getCompactSummaryActions,
  type CompactMeetingPane,
} from '@/lib/responsive-meeting-workspace';

const workspaceSource = readFileSync(
  new URL('../../src/app/meeting-details/page-content.tsx', import.meta.url),
  'utf8',
);
const tabsSource = readFileSync(
  new URL('../../src/components/MeetingDetails/MeetingWorkspaceTabs.tsx', import.meta.url),
  'utf8',
);

describe('responsive meeting workspace', () => {
  test('opens the summary pane by default in compact mode', () => {
    expect(DEFAULT_COMPACT_MEETING_PANE satisfies CompactMeetingPane).toBe('summary');
  });

  test('keeps all available secondary summary actions in the compact menu', () => {
    expect(getCompactSummaryActions({
      hasSummary: true,
      hasTemplates: true,
      hasTranscripts: true,
      isGenerating: false,
    })).toEqual([
      'external-ai',
      'paste-ai-result',
      'ai-model',
      'template',
      'copy-summary',
    ]);
  });

  test('omits actions that need unavailable summary data', () => {
    expect(getCompactSummaryActions({
      hasSummary: false,
      hasTemplates: false,
      hasTranscripts: true,
      isGenerating: false,
    })).toEqual([
      'external-ai',
      'paste-ai-result',
      'ai-model',
    ]);
  });

  test('matches the existing toolbar restrictions while generation is active', () => {
    expect(getCompactSummaryActions({
      hasSummary: true,
      hasTemplates: true,
      hasTranscripts: true,
      isGenerating: true,
    })).toEqual(['ai-model', 'template']);
  });

  test('does not expose summary actions without transcripts', () => {
    expect(getCompactSummaryActions({
      hasSummary: false,
      hasTemplates: true,
      hasTranscripts: false,
      isGenerating: false,
    })).toEqual([]);
  });

  test('moves between compact panes with either arrow direction', () => {
    expect(getAdjacentCompactPane('summary', 'ArrowLeft')).toBe('transcript');
    expect(getAdjacentCompactPane('transcript', 'ArrowRight')).toBe('summary');
    expect(getAdjacentCompactPane('summary', 'ArrowRight')).toBe('transcript');
  });

  test('keeps the compact pane switcher outside normal document flow', () => {
    expect(tabsSource).toContain('absolute');
    expect(tabsSource).toContain('bottom-');
    expect(workspaceSource).toContain('relative');
  });

  test('keeps pane endings reachable behind the floating switcher', () => {
    expect(workspaceSource.match(/pb-20/g)?.length).toBe(2);
  });
});
