import { invoke } from "@tauri-apps/api/core";
import type { BlockNoteBlock, Summary } from "@/types";

export interface EditableSummaryPayload {
  markdown?: string;
  summary_json?: BlockNoteBlock[];
}

export type SummarySaveInput = Summary | EditableSummaryPayload;

export type SummarySavePayload =
  | EditableSummaryPayload
  | {
      MeetingName: string;
      MeetingNotes: {
        sections: Array<Summary[string]>;
      };
    };

interface SaveDirtyMeetingChangesOptions {
  isTitleDirty: boolean;
  isSummaryDirty: boolean;
  saveTitle: () => Promise<void>;
  saveSummary: () => Promise<void>;
}

export function shouldClearSummaryDirtyAfterSave(
  savedRevision: number,
  currentRevision: number,
): boolean {
  return savedRevision === currentRevision;
}

export function formatSummaryForSave(
  summary: SummarySaveInput,
  meetingTitle: string,
): SummarySavePayload {
  if ("markdown" in summary || "summary_json" in summary) {
    return summary as EditableSummaryPayload;
  }

  return {
    MeetingName: meetingTitle,
    MeetingNotes: {
      sections: Object.values(summary).map((section) => ({
        title: section.title,
        blocks: section.blocks,
      })),
    },
  };
}

export async function persistMeetingSummary(
  meetingId: string,
  meetingTitle: string,
  summary: SummarySaveInput,
): Promise<SummarySavePayload> {
  const formattedSummary = formatSummaryForSave(summary, meetingTitle);

  await invoke("api_save_meeting_summary", {
    meetingId,
    summary: formattedSummary,
  });

  return formattedSummary;
}

export async function saveDirtyMeetingChanges({
  isTitleDirty,
  isSummaryDirty,
  saveTitle,
  saveSummary,
}: SaveDirtyMeetingChangesOptions): Promise<void> {
  if (isTitleDirty) {
    await saveTitle();
  }

  if (isSummaryDirty) {
    await saveSummary();
  }
}
