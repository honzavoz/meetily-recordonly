import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

const readSource = (relativePath: string) => readFileSync(
  new URL(`../../src/${relativePath}`, import.meta.url),
  'utf8',
);

const mainContentSource = readSource('components/MainContent/index.tsx');
const meetingWorkspaceSource = readSource('app/meeting-details/page-content.tsx');
const switcherSource = readSource('components/MeetingDetails/MeetingWorkspaceTabs.tsx');
const summaryPanelSource = readSource('components/MeetingDetails/SummaryPanel.tsx');
const globalStyles = readSource('app/globals.css');

describe('sidebar-aware meeting workspace', () => {
  test('main content subtracts the active fixed sidebar width', () => {
    expect(mainContentSource).toContain("w-[calc(100%-4rem)]");
    expect(mainContentSource).toContain("w-[calc(100%-16rem)]");
    expect(mainContentSource).toContain('meetily-main-content');
    expect(mainContentSource).toContain('min-w-0');
    expect(mainContentSource).toContain('overflow-hidden');
  });

  test('main content establishes the inline-size query boundary', () => {
    expect(globalStyles).toContain('container: meetily-main / inline-size');
    expect(globalStyles).toContain('@container meetily-main (min-width: 1024px)');
  });

  test('meeting panes use container-aware classes instead of viewport breakpoints', () => {
    expect(meetingWorkspaceSource).toContain('meeting-transcript-pane');
    expect(meetingWorkspaceSource).toContain('meeting-summary-pane');
    expect(meetingWorkspaceSource).not.toContain('lg:flex');
    expect(meetingWorkspaceSource).not.toContain('lg:max-w');
    expect(meetingWorkspaceSource).not.toContain('lg:pb-0');
  });

  test('switcher and summary action variants follow the same content container', () => {
    expect(switcherSource).toContain('meeting-workspace-switcher');
    expect(switcherSource).not.toContain('lg:hidden');
    expect(summaryPanelSource).toContain('meeting-summary-actions-wide');
    expect(summaryPanelSource).toContain('meeting-summary-actions-compact');
    expect(summaryPanelSource).not.toContain('lg:flex');
    expect(summaryPanelSource).not.toContain('lg:hidden');
  });
});
