import { describe, expect, test } from "bun:test";
import {
  filterSidebarMeetings,
  formatSidebarDateTime,
  getSidebarMeetingSubtitle,
  type SidebarMeetingListItem,
} from "@/lib/sidebar-meetings";

const meeting = (
  overrides: Partial<SidebarMeetingListItem> = {},
): SidebarMeetingListItem => ({
  id: "meeting-1",
  title: "Client kickoff",
  createdAt: new Date(2026, 6, 5, 13, 42).toISOString(),
  updatedAt: new Date(2026, 6, 5, 14, 5).toISOString(),
  type: "file",
  ...overrides,
});

describe("sidebar meeting helpers", () => {
  test("formats meeting timestamps for compact sidebar display", () => {
    const timestamp = new Date(2026, 6, 5, 13, 42).getTime();

    expect(formatSidebarDateTime(timestamp)).toBe("Jul 5, 2026, 13:42");
  });

  test("returns an empty subtitle when no meeting timestamp exists", () => {
    expect(getSidebarMeetingSubtitle(meeting({ createdAt: null }))).toBe("");
  });

  test("filters meetings by title and timestamp", () => {
    const clientKickoff = meeting();
    const planning = meeting({
      id: "meeting-2",
      title: "Planning",
      createdAt: new Date(2026, 10, 20, 9, 5).toISOString(),
    });

    expect(filterSidebarMeetings([clientKickoff, planning], "kick")).toEqual([clientKickoff]);
    expect(filterSidebarMeetings([clientKickoff, planning], "2026")).toEqual([clientKickoff, planning]);
    expect(filterSidebarMeetings([clientKickoff, planning], "Nov 20")).toEqual([planning]);
    expect(filterSidebarMeetings([clientKickoff, planning], "   ")).toEqual([clientKickoff, planning]);
  });
});
