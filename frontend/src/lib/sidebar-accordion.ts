export type SidebarAccordionSection = 'transcribeLater' | 'meetings';

export interface SidebarSectionState {
  transcribeLaterOpen: boolean;
  meetingsOpen: boolean;
}

export const SIDEBAR_ACCORDION_STORAGE_KEY = 'meetily.sidebar.sectionState';
export const LEGACY_SIDEBAR_ACCORDION_STORAGE_KEY = 'meetily.sidebar.openSection';

const defaultState = (hasPendingRecordings: boolean): SidebarSectionState => ({
  transcribeLaterOpen: hasPendingRecordings,
  meetingsOpen: true,
});

export function isSidebarSectionState(value: unknown): value is SidebarSectionState {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Partial<SidebarSectionState>;

  return typeof candidate.transcribeLaterOpen === 'boolean'
    && typeof candidate.meetingsOpen === 'boolean';
}

function parseStoredSectionState(storedState?: string | null): SidebarSectionState | null {
  if (!storedState) {
    return null;
  }

  try {
    const parsed = JSON.parse(storedState);
    return isSidebarSectionState(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function getDefaultSidebarSectionState(options: {
  hasPendingRecordings: boolean;
  storedState?: string | null;
  legacyStoredSection?: string | null;
}): SidebarSectionState {
  const storedState = parseStoredSectionState(options.storedState);
  const initialState = storedState ?? (() => {
    if (options.legacyStoredSection === 'transcribeLater') {
      return {
        transcribeLaterOpen: true,
        meetingsOpen: false,
      };
    }

    if (options.legacyStoredSection === 'meetings') {
      return {
        transcribeLaterOpen: false,
        meetingsOpen: true,
      };
    }

    return defaultState(options.hasPendingRecordings);
  })();

  return {
    ...initialState,
    transcribeLaterOpen: options.hasPendingRecordings && initialState.transcribeLaterOpen,
  };
}

export function getNextSidebarSectionState(options: {
  currentState: SidebarSectionState;
  section: SidebarAccordionSection;
  hasPendingRecordings: boolean;
}): SidebarSectionState {
  if (options.section === 'transcribeLater') {
    return {
      ...options.currentState,
      transcribeLaterOpen: options.hasPendingRecordings
        ? !options.currentState.transcribeLaterOpen
        : false,
    };
  }

  return {
    ...options.currentState,
    meetingsOpen: !options.currentState.meetingsOpen,
  };
}
