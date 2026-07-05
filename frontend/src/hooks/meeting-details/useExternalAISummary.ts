import { useCallback, useState } from "react";
import { invoke as invokeTauri } from "@tauri-apps/api/core";
import { toast } from "sonner";
import type { Transcript } from "@/types";
import {
  buildExternalAISummaryPromptPackage,
  createExternalAISummaryPayload,
  type ExternalAISummaryPromptPackage,
  type ExternalAISummaryTemplate,
} from "@/lib/external-ai-summary";

interface UseExternalAISummaryProps {
  meeting: {
    id: string;
    title: string;
    created_at: string;
  };
  meetingTitle: string;
  selectedTemplate: string;
  customPrompt: string;
  summaryLanguageLabel: string;
  hasSummary: boolean;
  onSaveSummary: (summary: { markdown: string }) => Promise<void>;
  setAiSummary: (summary: any) => void;
}

export function useExternalAISummary({
  meeting,
  meetingTitle,
  selectedTemplate,
  customPrompt,
  summaryLanguageLabel,
  hasSummary,
  onSaveSummary,
  setAiSummary,
}: UseExternalAISummaryProps) {
  const [promptDialogOpen, setPromptDialogOpen] = useState(false);
  const [pasteDialogOpen, setPasteDialogOpen] = useState(false);
  const [promptPackage, setPromptPackage] = useState<ExternalAISummaryPromptPackage | null>(null);
  const [selectedPromptIndex, setSelectedPromptIndex] = useState(0);
  const [pasteValue, setPasteValue] = useState("");
  const [overwriteConfirmed, setOverwriteConfirmed] = useState(false);
  const [isPreparingPrompt, setIsPreparingPrompt] = useState(false);
  const [isSavingPaste, setIsSavingPaste] = useState(false);

  const fetchAllTranscripts = useCallback(async (): Promise<Transcript[]> => {
    const firstPage = await invokeTauri("api_get_meeting_transcripts", {
      meetingId: meeting.id,
      limit: 1,
      offset: 0,
    }) as { transcripts: Transcript[]; total_count: number; has_more: boolean };

    if (!firstPage.total_count) {
      return [];
    }

    const allData = await invokeTauri("api_get_meeting_transcripts", {
      meetingId: meeting.id,
      limit: firstPage.total_count,
      offset: 0,
    }) as { transcripts: Transcript[]; total_count: number; has_more: boolean };

    return allData.transcripts;
  }, [meeting.id]);

  const copyText = useCallback(async (text: string, successMessage: string) => {
    await navigator.clipboard.writeText(text);
    toast.success(successMessage);
  }, []);

  const copyPromptPart = useCallback(async (index: number) => {
    if (!promptPackage?.parts[index]) return;
    setSelectedPromptIndex(index);
    await copyText(promptPackage.parts[index].text, `${promptPackage.parts[index].title} copied`);
  }, [copyText, promptPackage]);

  const copyMergePrompt = useCallback(async () => {
    if (!promptPackage) return;
    await copyText(promptPackage.mergePrompt.text, "Final merge prompt copied");
  }, [copyText, promptPackage]);

  const prepareExternalAIPrompt = useCallback(async () => {
    setIsPreparingPrompt(true);

    try {
      const [allTranscripts, template] = await Promise.all([
        fetchAllTranscripts(),
        invokeTauri("api_get_template_details", { templateId: selectedTemplate }) as Promise<ExternalAISummaryTemplate>,
      ]);

      if (!allTranscripts.length) {
        toast.error("No transcripts available for External AI");
        return;
      }

      const prepared = buildExternalAISummaryPromptPackage({
        meetingTitle,
        meetingDate: meeting.created_at,
        template,
        summaryLanguageLabel,
        customPrompt,
        transcripts: allTranscripts,
      });

      setPromptPackage(prepared);
      setSelectedPromptIndex(0);
      setPromptDialogOpen(true);

      await navigator.clipboard.writeText(prepared.parts[0].text);
      toast.success(
        prepared.mode === "chunked" ? "Part 1 copied for External AI" : "Prompt copied for External AI",
        {
          description: prepared.warning || "Paste it into ChatGPT, Claude, Gemini, or another AI tool.",
        },
      );
    } catch (error) {
      console.error("Failed to prepare External AI prompt:", error);
      toast.error("Failed to prepare External AI prompt", {
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setIsPreparingPrompt(false);
    }
  }, [customPrompt, fetchAllTranscripts, meeting.created_at, meetingTitle, selectedTemplate, summaryLanguageLabel]);

  const openPasteDialog = useCallback(() => {
    setPasteDialogOpen(true);
    setOverwriteConfirmed(false);
  }, []);

  const pasteFromClipboard = useCallback(async () => {
    try {
      const text = await navigator.clipboard.readText();
      setPasteValue(text);
      toast.success("Clipboard pasted into AI result");
    } catch (error) {
      console.error("Failed to read clipboard:", error);
      toast.error("Could not read clipboard", {
        description: "Paste the AI result manually into the text area.",
      });
    }
  }, []);

  const savePastedResult = useCallback(async () => {
    if (hasSummary && !overwriteConfirmed) {
      toast.warning("Confirm replacement before saving", {
        description: "This meeting already has notes. Check the replace confirmation first.",
      });
      return;
    }

    setIsSavingPaste(true);

    try {
      const payload = createExternalAISummaryPayload(pasteValue);
      await onSaveSummary(payload);
      setAiSummary(payload);
      setPasteDialogOpen(false);
      setPasteValue("");
      setOverwriteConfirmed(false);
      toast.success("External AI result saved", {
        description: "The pasted Markdown is now saved as meeting notes.",
      });
    } catch (error) {
      console.error("Failed to save External AI result:", error);
      toast.error("Failed to save External AI result", {
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setIsSavingPaste(false);
    }
  }, [hasSummary, onSaveSummary, overwriteConfirmed, pasteValue, setAiSummary]);

  return {
    promptDialogOpen,
    setPromptDialogOpen,
    pasteDialogOpen,
    setPasteDialogOpen,
    promptPackage,
    selectedPromptIndex,
    pasteValue,
    setPasteValue,
    overwriteConfirmed,
    setOverwriteConfirmed,
    isPreparingPrompt,
    isSavingPaste,
    prepareExternalAIPrompt,
    copyPromptPart,
    copyMergePrompt,
    openPasteDialog,
    pasteFromClipboard,
    savePastedResult,
  };
}
