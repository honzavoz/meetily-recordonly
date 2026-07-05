import { describe, expect, test } from "bun:test";
import {
  getDefaultSidebarSectionState,
  getNextSidebarSectionState,
  isSidebarSectionState,
} from "@/lib/sidebar-accordion";

describe("sidebar section visibility helpers", () => {
  test("defaults to both sections open when pending recordings exist", () => {
    expect(getDefaultSidebarSectionState({ hasPendingRecordings: true })).toEqual({
      transcribeLaterOpen: true,
      meetingsOpen: true,
    });
  });

  test("defaults to Meeting Notes only when no pending recordings exist", () => {
    expect(getDefaultSidebarSectionState({ hasPendingRecordings: false })).toEqual({
      transcribeLaterOpen: false,
      meetingsOpen: true,
    });
  });

  test("keeps an explicit stored state including both collapsed", () => {
    expect(getDefaultSidebarSectionState({
      hasPendingRecordings: true,
      storedState: JSON.stringify({
        transcribeLaterOpen: false,
        meetingsOpen: false,
      }),
    })).toEqual({
      transcribeLaterOpen: false,
      meetingsOpen: false,
    });
  });

  test("keeps an explicit stored state including both open", () => {
    expect(getDefaultSidebarSectionState({
      hasPendingRecordings: true,
      storedState: JSON.stringify({
        transcribeLaterOpen: true,
        meetingsOpen: true,
      }),
    })).toEqual({
      transcribeLaterOpen: true,
      meetingsOpen: true,
    });
  });

  test("keeps To Transcribe collapsed when no pending recordings exist", () => {
    expect(getDefaultSidebarSectionState({
      hasPendingRecordings: false,
      storedState: JSON.stringify({
        transcribeLaterOpen: true,
        meetingsOpen: false,
      }),
    })).toEqual({
      transcribeLaterOpen: false,
      meetingsOpen: false,
    });
  });

  test("rejects invalid stored states", () => {
    expect(isSidebarSectionState({
      transcribeLaterOpen: true,
      meetingsOpen: false,
    })).toBe(true);
    expect(isSidebarSectionState("meetings")).toBe(false);
    expect(isSidebarSectionState({ transcribeLaterOpen: true })).toBe(false);
  });

  test("toggles only the requested section", () => {
    expect(getNextSidebarSectionState({
      currentState: {
        transcribeLaterOpen: true,
        meetingsOpen: false,
      },
      section: "meetings",
      hasPendingRecordings: true,
    })).toEqual({
      transcribeLaterOpen: true,
      meetingsOpen: true,
    });

    expect(getNextSidebarSectionState({
      currentState: {
        transcribeLaterOpen: true,
        meetingsOpen: true,
      },
      section: "transcribeLater",
      hasPendingRecordings: true,
    })).toEqual({
      transcribeLaterOpen: false,
      meetingsOpen: true,
    });
  });
});
