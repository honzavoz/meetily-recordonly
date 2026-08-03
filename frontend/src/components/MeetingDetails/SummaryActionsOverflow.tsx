"use client";

import {
  Check,
  Clipboard,
  ClipboardPaste,
  Copy,
  FileText,
  MoreHorizontal,
  Settings,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import Analytics from '@/lib/analytics';
import { getCompactSummaryActions } from '@/lib/responsive-meeting-workspace';

interface SummaryActionsOverflowProps {
  hasSummary: boolean;
  hasTranscripts: boolean;
  isGenerating: boolean;
  templates: Array<{ id: string; name: string; description: string }>;
  selectedTemplate: string;
  isPreparingExternalAI: boolean;
  onPrepareExternalAI: () => void;
  onOpenPasteExternalAI: () => void;
  onOpenModelSettings: () => void;
  onTemplateSelect: (id: string, name: string) => void;
  onCopySummary: () => Promise<void>;
}

export function SummaryActionsOverflow({
  hasSummary,
  hasTranscripts,
  isGenerating,
  templates,
  selectedTemplate,
  isPreparingExternalAI,
  onPrepareExternalAI,
  onOpenPasteExternalAI,
  onOpenModelSettings,
  onTemplateSelect,
  onCopySummary,
}: SummaryActionsOverflowProps) {
  const actions = getCompactSummaryActions({
    hasSummary,
    hasTemplates: templates.length > 0,
    hasTranscripts,
    isGenerating,
  });

  if (actions.length === 0) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="shrink-0 cursor-pointer gap-2"
          aria-label="More summary actions"
          title="More summary actions"
        >
          <MoreHorizontal size={18} />
          <span className="hidden sm:inline">More</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56 max-w-[calc(100vw-2rem)]">
        {actions.includes('external-ai') && (
          <DropdownMenuItem
            disabled={isPreparingExternalAI}
            onSelect={() => {
              Analytics.trackButtonClick('copy_external_ai_prompt', 'meeting_details');
              onPrepareExternalAI();
            }}
          >
            <Clipboard />
            {isPreparingExternalAI ? 'Preparing External AI…' : 'External AI'}
          </DropdownMenuItem>
        )}

        {actions.includes('paste-ai-result') && (
          <DropdownMenuItem
            onSelect={() => {
              Analytics.trackButtonClick('paste_external_ai_result', 'meeting_details');
              onOpenPasteExternalAI();
            }}
          >
            <ClipboardPaste />
            Paste AI Result
          </DropdownMenuItem>
        )}

        {actions.includes('ai-model') && (
          <DropdownMenuItem onSelect={onOpenModelSettings}>
            <Settings />
            AI Model
          </DropdownMenuItem>
        )}

        {actions.includes('template') && (
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <FileText />
              Template
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="max-w-[calc(100vw-2rem)]">
              {templates.map((template) => (
                <DropdownMenuItem
                  key={template.id}
                  title={template.description}
                  onSelect={() => onTemplateSelect(template.id, template.name)}
                >
                  <span className="min-w-0 flex-1 truncate">{template.name}</span>
                  {selectedTemplate === template.id && <Check />}
                </DropdownMenuItem>
              ))}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        )}

        {actions.includes('copy-summary') && (
          <DropdownMenuItem
            onSelect={() => {
              Analytics.trackButtonClick('copy_summary', 'meeting_details');
              void onCopySummary();
            }}
          >
            <Copy />
            Copy Summary
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
