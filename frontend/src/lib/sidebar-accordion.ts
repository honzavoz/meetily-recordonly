export type SidebarAccordionSection = 'transcribeLater' | 'meetings';

export const SIDEBAR_ACCORDION_STORAGE_KEY = 'meetily.sidebar.openSection';

export function isSidebarAccordionSection(value: unknown): value is SidebarAccordionSection {
  return value === 'transcribeLater' || value === 'meetings';
}

export function getDefaultSidebarAccordionSection(options: {
  hasPendingRecordings: boolean;
  storedSection?: string | null;
}): SidebarAccordionSection {
  if (options.storedSection === 'meetings') {
    return 'meetings';
  }

  if (options.storedSection === 'transcribeLater' && options.hasPendingRecordings) {
    return 'transcribeLater';
  }

  return options.hasPendingRecordings ? 'transcribeLater' : 'meetings';
}

export function getAvailableSidebarAccordionSection(options: {
  requestedSection: SidebarAccordionSection;
  hasPendingRecordings: boolean;
}): SidebarAccordionSection {
  if (options.requestedSection === 'transcribeLater' && !options.hasPendingRecordings) {
    return 'meetings';
  }

  return options.requestedSection;
}
