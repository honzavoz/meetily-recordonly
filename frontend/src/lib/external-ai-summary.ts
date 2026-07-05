import type { Transcript } from "@/types";

export interface ExternalAISummaryTemplateSection {
  title: string;
  instruction: string;
  format: string;
  item_format?: string | null;
  example_item_format?: string | null;
}

export interface ExternalAISummaryTemplate {
  id: string;
  name: string;
  description: string;
  sections: ExternalAISummaryTemplateSection[];
}

export interface ExternalAISummaryPromptPart {
  title: string;
  text: string;
}

export interface ExternalAISummaryPromptPackage {
  mode: "single" | "chunked";
  parts: ExternalAISummaryPromptPart[];
  mergePrompt: ExternalAISummaryPromptPart;
  warning: string | null;
}

interface BuildPromptPackageInput {
  meetingTitle: string;
  meetingDate: Date | string | number;
  template: ExternalAISummaryTemplate;
  summaryLanguageLabel: string;
  customPrompt?: string;
  transcripts: Transcript[];
  maxPromptCharacters?: number;
}

const DEFAULT_MAX_PROMPT_CHARACTERS = 28000;

function formatTranscriptTime(seconds: number | undefined, fallbackTimestamp: string): string {
  if (seconds === undefined || Number.isNaN(seconds)) {
    return fallbackTimestamp;
  }

  const totalSecs = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(totalSecs / 3600);
  const mins = Math.floor((totalSecs % 3600) / 60);
  const secs = totalSecs % 60;

  if (hours > 0) {
    return `[${hours}:${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}]`;
  }

  return `[${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}]`;
}

function formatMeetingDate(value: Date | string | number): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return String(value);
  }

  return date.toLocaleString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatTranscript(transcripts: Transcript[]): string {
  return transcripts
    .map((transcript) => `${formatTranscriptTime(transcript.audio_start_time, transcript.timestamp)} ${transcript.text}`)
    .join("\n");
}

function formatTemplateStructure(template: ExternalAISummaryTemplate): string {
  return template.sections
    .map((section) => {
      const lines = [
        `## ${section.title}`,
        `Instruction: ${section.instruction}`,
        `Format: ${section.format}`,
      ];

      const itemFormat = section.item_format || section.example_item_format;
      if (itemFormat) {
        lines.push(`Required item/table format:\n${itemFormat}`);
      }

      return lines.join("\n");
    })
    .join("\n\n");
}

function buildPromptShell(input: BuildPromptPackageInput, transcriptText: string, context: string): string {
  const customPrompt = input.customPrompt?.trim();

  return [
    "You are helping create meeting notes from a transcript.",
    "",
    "Critical output rules:",
    "- Return Markdown only.",
    "- Do not wrap the answer in a code block.",
    "- Do not add an intro, outro, explanation, or commentary.",
    "- Use only information present in the transcript or extra context.",
    "- Do not invent owners, dates, decisions, or action items.",
    "- If a template section has no relevant information, write \"None noted in this section.\"",
    "- Preserve transcript timestamps when referencing action items, decisions, or important details.",
    "",
    `Meeting title: ${input.meetingTitle || "Untitled meeting"}`,
    `Meeting date: ${formatMeetingDate(input.meetingDate)}`,
    `Output language: ${input.summaryLanguageLabel || "Auto"}`,
    `Use the selected summary template exactly: ${input.template.name}`,
    "",
    "Selected template:",
    formatTemplateStructure(input.template),
    "",
    customPrompt ? `Extra context:\n${customPrompt}` : "Extra context: None provided.",
    "",
    context,
    "",
    "Transcript:",
    transcriptText,
  ].join("\n");
}

function splitTranscriptsIntoChunks(
  transcripts: Transcript[],
  input: BuildPromptPackageInput,
  maxPromptCharacters: number,
): Transcript[][] {
  const chunks: Transcript[][] = [];
  let current: Transcript[] = [];

  for (const transcript of transcripts) {
    const candidate = [...current, transcript];
    const candidateText = formatTranscript(candidate);
    const candidatePrompt = buildPromptShell(
      input,
      candidateText,
      "Create a partial summary from this transcript part. Keep all important details because another AI pass will merge partial summaries later.",
    );

    if (current.length > 0 && candidatePrompt.length > maxPromptCharacters) {
      chunks.push(current);
      current = [transcript];
    } else {
      current = candidate;
    }
  }

  if (current.length > 0) {
    chunks.push(current);
  }

  return chunks.length > 0 ? chunks : [[]];
}

function buildMergePrompt(input: BuildPromptPackageInput, partCount: number): ExternalAISummaryPromptPart {
  return {
    title: "Copy final merge prompt",
    text: [
      "You are combining partial meeting summaries into one final meeting note.",
      "",
      "Critical output rules:",
      "- Return Markdown only.",
      "- Do not wrap the answer in a code block.",
      "- Do not add an intro, outro, explanation, or commentary.",
      "- Deduplicate repeated details across parts.",
      "- Do not invent owners, dates, decisions, or action items.",
      "- Preserve transcript timestamps where the partial summaries include them.",
      "",
      `Meeting title: ${input.meetingTitle || "Untitled meeting"}`,
      `Meeting date: ${formatMeetingDate(input.meetingDate)}`,
      `Output language: ${input.summaryLanguageLabel || "Auto"}`,
      `Combine the partial summaries into the selected summary template exactly: ${input.template.name}`,
      "",
      "Selected template:",
      formatTemplateStructure(input.template),
      "",
      `I will paste ${partCount} partial summaries below this prompt. Combine them into the final Markdown summary.`,
    ].join("\n"),
  };
}

export function buildExternalAISummaryPromptPackage(input: BuildPromptPackageInput): ExternalAISummaryPromptPackage {
  const maxPromptCharacters = input.maxPromptCharacters ?? DEFAULT_MAX_PROMPT_CHARACTERS;
  const singleTranscriptText = formatTranscript(input.transcripts);
  const singlePrompt = buildPromptShell(
    input,
    singleTranscriptText,
    "Create the final meeting notes directly from this transcript.",
  );

  if (singlePrompt.length <= maxPromptCharacters) {
    return {
      mode: "single",
      parts: [{ title: "Copy prompt", text: singlePrompt }],
      mergePrompt: buildMergePrompt(input, 1),
      warning: null,
    };
  }

  const chunks = splitTranscriptsIntoChunks(input.transcripts, input, maxPromptCharacters);
  const parts = chunks.map((chunk, index) => {
    const total = chunks.length;
    return {
      title: `Copy part ${index + 1}`,
      text: buildPromptShell(
        input,
        formatTranscript(chunk),
        `PART ${index + 1} OF ${total}. Create a partial summary from this transcript part. Keep all facts, decisions, action items, owners, dates, and timestamps needed for the final merge.`,
      ),
    };
  });

  return {
    mode: "chunked",
    parts,
    mergePrompt: buildMergePrompt(input, parts.length),
    warning: `This meeting is long, so the external AI prompt was split into ${parts.length} parts plus a final merge prompt.`,
  };
}

function stripSharedIndent(value: string): string {
  const lines = value.split("\n");
  const indentedLines = lines.filter((line) => line.trim().length > 0);
  const indent = indentedLines.reduce((min, line) => {
    const match = line.match(/^\s*/);
    return Math.min(min, match?.[0].length ?? 0);
  }, Number.POSITIVE_INFINITY);

  if (!Number.isFinite(indent) || indent === 0) {
    return value;
  }

  return lines.map((line) => line.slice(indent)).join("\n");
}

export function sanitizeExternalAISummaryMarkdown(value: string): string {
  const withoutThinking = value.replace(/<think(?:ing)?[\s\S]*?<\/think(?:ing)?>/gi, "");
  let markdown = stripSharedIndent(withoutThinking).trim();

  const fenceMatch = markdown.match(/^```(?:markdown)?\s*\n([\s\S]*?)\n```$/i);
  if (fenceMatch) {
    markdown = fenceMatch[1].trim();
  }

  return stripSharedIndent(markdown).trim();
}

export function createExternalAISummaryPayload(value: string): { markdown: string } {
  const markdown = sanitizeExternalAISummaryMarkdown(value);

  if (!markdown) {
    throw new Error("Paste a non-empty AI result first");
  }

  return { markdown };
}
