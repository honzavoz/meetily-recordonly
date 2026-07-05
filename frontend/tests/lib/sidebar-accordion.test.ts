import { describe, expect, test } from "bun:test";
import {
  getAvailableSidebarAccordionSection,
  getDefaultSidebarAccordionSection,
  isSidebarAccordionSection,
} from "@/lib/sidebar-accordion";

describe("sidebar accordion helpers", () => {
  test("defaults to To Transcribe when pending recordings exist", () => {
    expect(getDefaultSidebarAccordionSection({ hasPendingRecordings: true })).toBe("transcribeLater");
  });

  test("defaults to Meeting Notes when no pending recordings exist", () => {
    expect(getDefaultSidebarAccordionSection({ hasPendingRecordings: false })).toBe("meetings");
  });

  test("keeps a stored section when it is available", () => {
    expect(getDefaultSidebarAccordionSection({
      hasPendingRecordings: true,
      storedSection: "meetings",
    })).toBe("meetings");

    expect(getDefaultSidebarAccordionSection({
      hasPendingRecordings: true,
      storedSection: "transcribeLater",
    })).toBe("transcribeLater");
  });

  test("falls back to Meeting Notes when stored To Transcribe has no pending recordings", () => {
    expect(getDefaultSidebarAccordionSection({
      hasPendingRecordings: false,
      storedSection: "transcribeLater",
    })).toBe("meetings");
  });

  test("rejects invalid stored sections", () => {
    expect(isSidebarAccordionSection("meetings")).toBe(true);
    expect(isSidebarAccordionSection("transcribeLater")).toBe(true);
    expect(isSidebarAccordionSection("settings")).toBe(false);
  });

  test("only allows To Transcribe when pending recordings exist", () => {
    expect(getAvailableSidebarAccordionSection({
      requestedSection: "transcribeLater",
      hasPendingRecordings: false,
    })).toBe("meetings");

    expect(getAvailableSidebarAccordionSection({
      requestedSection: "transcribeLater",
      hasPendingRecordings: true,
    })).toBe("transcribeLater");
  });
});
