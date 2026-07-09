import { describe, expect, test } from "bun:test";
import {
  buildExternalAISummaryPromptPackage,
  createExternalAISummaryPayload,
  sanitizeExternalAISummaryMarkdown,
  type ExternalAISummaryTemplate,
} from "@/lib/external-ai-summary";
import type { Transcript } from "@/types";

const template: ExternalAISummaryTemplate = {
  id: "standard_meeting",
  name: "Standard Meeting Notes",
  description: "A standard template for general meetings.",
  sections: [
    {
      title: "Summary",
      instruction: "Provide a brief executive summary.",
      format: "paragraph",
    },
    {
      title: "Action Items",
      instruction: "List all assigned tasks with owners and due dates.",
      format: "list",
      item_format: "| **Owner** | Task | Due | Reference Transcript Segment | Segment Timestamp |\n| --- | --- | --- | --- | --- |",
    },
  ],
};

const transcript = (overrides: Partial<Transcript> = {}): Transcript => ({
  id: "t1",
  timestamp: "13:42:00",
  audio_start_time: 65,
  text: "We agreed that Jana will send the proposal tomorrow.",
  ...overrides,
});

describe("external AI summary helpers", () => {
  test("builds a template-aware prompt for a manual external AI summary", () => {
    const promptPackage = buildExternalAISummaryPromptPackage({
      meetingTitle: "Client kickoff",
      meetingDate: new Date("2026-07-05T13:42:00+02:00"),
      template,
      summaryLanguageLabel: "Czech",
      customPrompt: "Client is price sensitive.",
      transcripts: [transcript()],
    });

    expect(promptPackage.mode).toBe("single");
    expect(promptPackage.parts).toHaveLength(1);
    const prompt = promptPackage.parts[0].text;

    expect(prompt).toContain("Generate a final meeting report by filling in the provided Markdown template");
    expect(prompt).toContain("Write the final meeting report in Czech.");
    expect(prompt).toContain("Client is price sensitive.");
    expect(prompt).toContain("**Summary**");
    expect(prompt).toContain("Provide a brief executive summary.");
    expect(prompt).toContain("| **Owner** | Task | Due | Reference Transcript Segment | Segment Timestamp |");
    expect(prompt).toContain("[01:05] We agreed that Jana will send the proposal tomorrow.");
    expect(prompt).toContain("Output **only** the completed Markdown report.");
    expect(prompt).not.toContain("```");
  });

  test("splits long transcripts into local-AI-like chunk prompts plus a final template prompt", () => {
    const longTranscripts = Array.from({ length: 8 }, (_, index) =>
      transcript({
        id: `t${index}`,
        audio_start_time: index * 60,
        text: `Segment ${index} ` + "important detail ".repeat(12),
      }),
    );

    const promptPackage = buildExternalAISummaryPromptPackage({
      meetingTitle: "Long planning",
      meetingDate: new Date("2026-07-05T13:42:00+02:00"),
      template,
      summaryLanguageLabel: "Auto",
      customPrompt: "",
      transcripts: longTranscripts,
      maxPromptCharacters: 900,
    });

    expect(promptPackage.mode).toBe("chunked");
    expect(promptPackage.parts.length).toBeGreaterThan(1);
    expect(promptPackage.parts[0].title).toBe("Copy part 1");
    expect(promptPackage.mergePrompt.title).toBe("Copy final merge prompt");
    expect(promptPackage.parts[0].text).toContain("You are an expert meeting summarizer.");
    expect(promptPackage.parts[0].text).toContain("Provide a concise but comprehensive summary of the following transcript chunk.");
    expect(promptPackage.parts[0].text).toContain("<transcript_chunk>");
    expect(promptPackage.parts[0].text).not.toContain("PART 1 OF");
    expect(promptPackage.parts[0].text).not.toContain("Standard Meeting Notes");
    expect(promptPackage.parts[0].text).not.toContain("## Action Items");
    expect(promptPackage.mergePrompt.text).toContain("Generate a final meeting report by filling in the provided Markdown template");
    expect(promptPackage.mergePrompt.text).toContain("Use the consecutive chunk summaries generated earlier in this chat as the source text.");
    expect(promptPackage.mergePrompt.text).toContain("Write the final meeting report in the dominant language of the source text.");
    expect(promptPackage.mergePrompt.text).toContain("**Action Items**");
  });

  test("sanitizes pasted AI markdown before saving it as a summary payload", () => {
    const markdown = sanitizeExternalAISummaryMarkdown(`
      <think>private reasoning</think>
      \`\`\`markdown
      # Client kickoff

      ## Summary
      Done.
      \`\`\`
    `);

    expect(markdown).toBe("# Client kickoff\n\n## Summary\nDone.");
    expect(createExternalAISummaryPayload(markdown)).toEqual({
      markdown: "# Client kickoff\n\n## Summary\nDone.",
    });
  });

  test("rejects empty pasted markdown", () => {
    expect(() => createExternalAISummaryPayload("   \n")).toThrow("Paste a non-empty AI result first");
  });
});
