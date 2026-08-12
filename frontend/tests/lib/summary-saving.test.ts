import { beforeEach, describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";

const invokeMock = mock(async () => ({ message: "saved" }));

mock.module("@tauri-apps/api/core", () => ({
  invoke: invokeMock,
}));

describe("summary saving", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    invokeMock.mockResolvedValue({ message: "saved" });
  });

  test("persists BlockNote data and returns the exact accepted payload", async () => {
    const { persistMeetingSummary } = await import("../../src/lib/summary-saving");
    const input = {
      markdown: "edited",
      summary_json: [{ id: "one", type: "paragraph" }],
    };

    await expect(
      persistMeetingSummary("meeting-1", "Title", input),
    ).resolves.toEqual(input);
    expect(invokeMock).toHaveBeenCalledWith("api_save_meeting_summary", {
      meetingId: "meeting-1",
      summary: input,
    });
  });

  test("propagates Tauri persistence failures", async () => {
    const { persistMeetingSummary } = await import("../../src/lib/summary-saving");
    invokeMock.mockRejectedValueOnce(new Error("database locked"));

    await expect(
      persistMeetingSummary("meeting-1", "Title", { markdown: "edited" }),
    ).rejects.toThrow("database locked");
  });

  test("does not invoke a summary save when the editor is clean", async () => {
    const { saveDirtyMeetingChanges } = await import("../../src/lib/summary-saving");
    const saveTitle = mock(async () => {});
    const saveSummary = mock(async () => {});

    await saveDirtyMeetingChanges({
      isTitleDirty: false,
      isSummaryDirty: false,
      saveTitle,
      saveSummary,
    });

    expect(saveTitle).not.toHaveBeenCalled();
    expect(saveSummary).not.toHaveBeenCalled();
  });

  test("waits for and propagates a dirty summary save failure", async () => {
    const { saveDirtyMeetingChanges } = await import("../../src/lib/summary-saving");
    const saveSummary = mock(async () => {
      throw new Error("write failed");
    });

    await expect(
      saveDirtyMeetingChanges({
        isTitleDirty: false,
        isSummaryDirty: true,
        saveTitle: mock(async () => {}),
        saveSummary,
      }),
    ).rejects.toThrow("write failed");
    expect(saveSummary).toHaveBeenCalledTimes(1);
  });

  test("keeps the editor dirty when a newer edit arrives during persistence", async () => {
    const { shouldClearSummaryDirtyAfterSave } = await import("../../src/lib/summary-saving");

    expect(shouldClearSummaryDirtyAfterSave(4, 4)).toBe(true);
    expect(shouldClearSummaryDirtyAfterSave(4, 5)).toBe(false);
  });

  test("the editor clears dirty state only after persistence succeeds", () => {
    const editorSource = readFileSync(
      new URL("../../src/components/AISummary/BlockNoteSummaryView.tsx", import.meta.url),
      "utf8",
    );
    const awaitedSave = editorSource.indexOf("await onSave(saveData)");
    const clearDirty = editorSource.indexOf("setIsDirty(false)", awaitedSave);

    expect(editorSource).toContain("onSave?: (data:");
    expect(editorSource).toContain("=> Promise<void>");
    expect(awaitedSave).toBeGreaterThan(-1);
    expect(clearDirty).toBeGreaterThan(awaitedSave);
    expect(editorSource).toContain("editRevisionRef.current += 1");
    expect(editorSource).toContain("shouldClearSummaryDirtyAfterSave(");
    expect(editorSource).not.toContain("alert(");
  });

  test("the meeting hook synchronizes saved data without a stale clean-editor write", () => {
    const hookSource = readFileSync(
      new URL("../../src/hooks/meeting-details/useMeetingData.ts", import.meta.url),
      "utf8",
    );

    expect(hookSource).toContain("persistMeetingSummary(");
    expect(hookSource).toContain("saveDirtyMeetingChanges({");
    expect(hookSource).toContain("setAiSummary(summary as Summary)");
    expect(hookSource).toContain("setIsSummaryDirty(true)");
    expect(hookSource).toContain("editorSummaryDirty || isSummaryDirty");
    expect(hookSource).toContain("legacySummaryRevisionRef.current += 1");
    expect(hookSource).toContain("savedRevision === legacySummaryRevisionRef.current");
    const capturedSnapshot = hookSource.indexOf("const summarySnapshot = aiSummary");
    const capturedRevision = hookSource.indexOf("const summarySnapshotRevision = legacySummaryRevisionRef.current");
    const saveSequence = hookSource.indexOf("await saveDirtyMeetingChanges({");
    expect(capturedSnapshot).toBeGreaterThan(-1);
    expect(capturedRevision).toBeGreaterThan(capturedSnapshot);
    expect(saveSequence).toBeGreaterThan(capturedRevision);
    expect(hookSource).toContain("handleSaveSummary(summarySnapshot, summarySnapshotRevision)");
    expect(hookSource).not.toContain("else if (aiSummary)");
  });

  test("the summary repository rejects an update that matches no summary row", () => {
    const repositorySource = readFileSync(
      new URL("../../src-tauri/src/database/repositories/summary.rs", import.meta.url),
      "utf8",
    );

    expect(repositorySource).toContain("summary_update.rows_affected() != 1");
    expect(repositorySource).toContain("transaction.rollback().await?");
  });
});
