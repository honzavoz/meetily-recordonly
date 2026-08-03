"use client";

import { Summary, SummaryResponse, Transcript } from '@/types';
import { EditableTitle } from '@/components/EditableTitle';
import { BlockNoteSummaryView, BlockNoteSummaryViewRef } from '@/components/AISummary/BlockNoteSummaryView';
import { EmptyStateSummary } from '@/components/EmptyStateSummary';
import { ModelConfig } from '@/components/ModelSettingsModal';
import { SummaryGeneratorButtonGroup } from './SummaryGeneratorButtonGroup';
import { SummaryUpdaterButtonGroup } from './SummaryUpdaterButtonGroup';
import { SummaryActionsOverflow } from './SummaryActionsOverflow';
import Analytics from '@/lib/analytics';
import { useEffect, useRef, useState, RefObject } from 'react';
import { toast } from 'sonner';
import { Languages, ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import { LanguagePickerPopover } from '@/components/LanguagePickerPopover';
import { useRecentLanguages } from '@/hooks/useRecentLanguages';
import { labelForCode } from '@/lib/summary-languages';
import { useExternalAISummary } from '@/hooks/meeting-details/useExternalAISummary';
import {
  readMeetingSummaryLanguage,
  saveMeetingSummaryLanguage,
  SummaryLanguageStorage,
} from '@/lib/summary-language-preferences';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { ProjectChips } from '@/components/Projects/ProjectChips';
import { ProjectPicker } from '@/components/Projects/ProjectPicker';
import type { Project } from '@/types/projects';
import { RESPONSIVE_MARKDOWN_SUMMARY_CLASSES } from '@/lib/responsive-markdown-summary';

interface SummaryPanelProps {
  meeting: {
    id: string;
    title: string;
    created_at: string;
  };
  meetingTitle: string;
  onTitleChange: (title: string) => void;
  isEditingTitle: boolean;
  onStartEditTitle: () => void;
  onFinishEditTitle: () => void;
  isTitleDirty: boolean;
  summaryRef: RefObject<BlockNoteSummaryViewRef>;
  isSaving: boolean;
  onSaveAll: () => Promise<void>;
  onCopySummary: () => Promise<void>;
  onOpenFolder: () => Promise<void>;
  aiSummary: Summary | null;
  summaryStatus: 'idle' | 'processing' | 'summarizing' | 'regenerating' | 'completed' | 'error';
  transcripts: Transcript[];
  modelConfig: ModelConfig;
  setModelConfig: (config: ModelConfig | ((prev: ModelConfig) => ModelConfig)) => void;
  onSaveModelConfig: (config?: ModelConfig) => Promise<void>;
  onGenerateSummary: (customPrompt: string) => Promise<void>;
  onStopGeneration: () => void;
  customPrompt: string;
  summaryResponse: SummaryResponse | null;
  onSaveSummary: (summary: Summary | { markdown?: string; summary_json?: any[] }) => Promise<void>;
  onSummaryChange: (summary: Summary) => void;
  onDirtyChange: (isDirty: boolean) => void;
  summaryError: string | null;
  onRegenerateSummary: () => Promise<void>;
  getSummaryStatusMessage: (status: 'idle' | 'processing' | 'summarizing' | 'regenerating' | 'completed' | 'error') => string;
  availableTemplates: Array<{ id: string, name: string, description: string }>;
  selectedTemplate: string;
  onTemplateSelect: (templateId: string, templateName: string) => void;
  isModelConfigLoading?: boolean;
  onOpenModelSettings?: (openFn: () => void) => void;
  projects: Project[];
  availableProjects: Project[];
  onAssignProject: (project: Project) => Promise<void>;
  onCreateProject: (name: string) => Promise<Project>;
  onRemoveProject: (project: Project) => Promise<void>;
}

export function SummaryPanel({
  meeting,
  meetingTitle,
  onTitleChange,
  isEditingTitle,
  onStartEditTitle,
  onFinishEditTitle,
  isTitleDirty,
  summaryRef,
  isSaving,
  onSaveAll,
  onCopySummary,
  onOpenFolder,
  aiSummary,
  summaryStatus,
  transcripts,
  modelConfig,
  setModelConfig,
  onSaveModelConfig,
  onGenerateSummary,
  onStopGeneration,
  customPrompt,
  summaryResponse: _summaryResponse,
  onSaveSummary,
  onSummaryChange,
  onDirtyChange,
  summaryError,
  onRegenerateSummary,
  getSummaryStatusMessage,
  availableTemplates,
  selectedTemplate,
  onTemplateSelect,
  isModelConfigLoading = false,
  onOpenModelSettings,
  projects,
  availableProjects,
  onAssignProject,
  onCreateProject,
  onRemoveProject,
}: SummaryPanelProps) {
  const [summaryLang, setSummaryLang] = useState<string | null>(null);
  const [summaryLangStorage, setSummaryLangStorage] = useState<SummaryLanguageStorage>('metadata');
  const [langPickerOpen, setLangPickerOpen] = useState(false);
  const languageLoadVersionRef = useRef(0);
  const activeMeetingIdRef = useRef(meeting.id);
  const languageSaveVersionRef = useRef(0);
  const languageSaveLoopRunningRef = useRef(false);
  const modelSettingsOpenRef = useRef<(() => void) | null>(null);
  const latestLanguageSaveRequestRef = useRef<{
    version: number;
    meetingId: string;
    language: string | null;
    rollback: {
      language: string | null;
      storage: SummaryLanguageStorage;
    };
  } | null>(null);
  activeMeetingIdRef.current = meeting.id;
  const { addRecent } = useRecentLanguages();

  const effectiveLangLabel = summaryLang ? labelForCode(summaryLang) : 'Auto';
  const isLocalFallbackLanguage = summaryLangStorage === 'local_fallback';
  const autoSubtitle = isLocalFallbackLanguage
    ? 'Saved on this device for folderless meetings'
    : 'Uses dominant transcript language';

  useEffect(() => {
    let cancelled = false;
    const loadVersion = languageLoadVersionRef.current + 1;
    languageLoadVersionRef.current = loadVersion;

    const loadSummaryLanguage = async () => {
      try {
        const stored = await readMeetingSummaryLanguage(meeting.id);
        if (!cancelled && languageLoadVersionRef.current === loadVersion) {
          setSummaryLang(stored.language);
          setSummaryLangStorage(stored.storage);
        }
      } catch (err) {
        console.error('Failed to load summary language:', err);
        toast.warning('Could not load saved summary language', {
          description: 'Using Auto until meeting metadata can be read.',
        });
        if (!cancelled && languageLoadVersionRef.current === loadVersion) setSummaryLang(null);
      }
    };

    loadSummaryLanguage();

    return () => {
      cancelled = true;
    };
  }, [meeting.id]);

  const persistLatestLanguageSelection = async () => {
    if (languageSaveLoopRunningRef.current) return;
    languageSaveLoopRunningRef.current = true;

    try {
      while (true) {
        const request = latestLanguageSaveRequestRef.current;
        if (!request) return;

        try {
          const saved = await saveMeetingSummaryLanguage(request.meetingId, request.language);
          const latest = latestLanguageSaveRequestRef.current;
          if (
            latest?.version === request.version &&
            activeMeetingIdRef.current === request.meetingId
          ) {
            setSummaryLang(saved.language);
            setSummaryLangStorage(saved.storage);
            if (saved.storage === 'local_fallback') {
              toast.info('Summary language saved on this device', {
                description: 'This meeting has no recording folder, so the preference cannot be written to meeting metadata.',
              });
            }
            if (request.language) {
              addRecent(request.language);
            }
            return;
          }

          if (latest?.version === request.version) return;
        } catch (err) {
          const latest = latestLanguageSaveRequestRef.current;
          if (
            latest?.version === request.version &&
            activeMeetingIdRef.current === request.meetingId
          ) {
            console.error('Failed to persist summary language:', err);
            toast.error('Failed to save summary language');
            setSummaryLang(request.rollback.language);
            setSummaryLangStorage(request.rollback.storage);
            return;
          }

          console.warn('Ignoring failed stale summary language save:', err);
          if (latest?.version === request.version) return;
        }
      }
    } finally {
      languageSaveLoopRunningRef.current = false;
    }
  };

  const handleLangChange = (code: string | null) => {
    const previous = summaryLang;
    const previousStorage = summaryLangStorage;
    const nextStored = code;
    languageLoadVersionRef.current += 1;
    latestLanguageSaveRequestRef.current = {
      version: languageSaveVersionRef.current + 1,
      meetingId: meeting.id,
      language: nextStored,
      rollback: {
        language: previous,
        storage: previousStorage,
      },
    };
    languageSaveVersionRef.current += 1;
    setSummaryLang(nextStored);
    setLangPickerOpen(false);
    void persistLatestLanguageSelection();
  };

  const isSummaryLoading = summaryStatus === 'processing' || summaryStatus === 'summarizing' || summaryStatus === 'regenerating';

  const languageSlot = (
    <Popover open={langPickerOpen} onOpenChange={setLangPickerOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          title={`Summary language: ${effectiveLangLabel}${isLocalFallbackLanguage ? ' (saved on this device)' : ''}`}
          aria-label="Set summary language"
        >
          <Languages size={18} />
          <span className="hidden sm:inline">{effectiveLangLabel}</span>
          <ChevronDown size={14} className="text-gray-400" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-auto max-w-[calc(100vw-2rem)] border-0 bg-transparent p-0 shadow-none"
      >
        <LanguagePickerPopover
          value={summaryLang}
          onChange={handleLangChange}
          onClose={() => setLangPickerOpen(false)}
          autoSubtitle={autoSubtitle}
        />
      </PopoverContent>
    </Popover>
  );

  const externalAI = useExternalAISummary({
    meeting,
    meetingTitle,
    selectedTemplate,
    customPrompt,
    summaryLanguageLabel: effectiveLangLabel,
    hasSummary: !!aiSummary,
    onSaveSummary: async (summary) => onSaveSummary(summary),
    setAiSummary: (summary) => onSummaryChange(summary as Summary),
  });

  const selectedExternalPrompt = externalAI.promptPackage?.parts[externalAI.selectedPromptIndex] ?? null;

  const registerModelSettingsOpen = (openFn: () => void) => {
    modelSettingsOpenRef.current = openFn;
    onOpenModelSettings?.(openFn);
  };

  const renderGenerator = (showSecondaryActions: boolean, showLanguage = true) => (
    <SummaryGeneratorButtonGroup
      modelConfig={modelConfig}
      setModelConfig={setModelConfig}
      onSaveModelConfig={onSaveModelConfig}
      onGenerateSummary={onGenerateSummary}
      onStopGeneration={onStopGeneration}
      customPrompt={customPrompt}
      summaryStatus={summaryStatus}
      availableTemplates={availableTemplates}
      selectedTemplate={selectedTemplate}
      onTemplateSelect={onTemplateSelect}
      hasTranscripts={transcripts.length > 0}
      hasSummary={!!aiSummary}
      isModelConfigLoading={isModelConfigLoading}
      isPreparingExternalAI={externalAI.isPreparingPrompt}
      onPrepareExternalAI={externalAI.prepareExternalAIPrompt}
      onOpenPasteExternalAI={externalAI.openPasteDialog}
      onOpenModelSettings={registerModelSettingsOpen}
      languageSlot={showLanguage && transcripts.length > 0 ? languageSlot : undefined}
      showSecondaryActions={showSecondaryActions}
    />
  );

  const renderUpdater = (showCopy: boolean) => (
    <SummaryUpdaterButtonGroup
      isSaving={isSaving}
      isDirty={isTitleDirty || (summaryRef.current?.isDirty || false)}
      onSave={onSaveAll}
      onCopy={onCopySummary}
      onOpenFolder={onOpenFolder}
      hasSummary={!!aiSummary}
      showCopy={showCopy}
    />
  );

  const compactOverflow = (
    <SummaryActionsOverflow
      hasSummary={!!aiSummary}
      hasTranscripts={transcripts.length > 0}
      isGenerating={isSummaryLoading}
      templates={availableTemplates}
      selectedTemplate={selectedTemplate}
      isPreparingExternalAI={externalAI.isPreparingPrompt}
      onPrepareExternalAI={externalAI.prepareExternalAIPrompt}
      onOpenPasteExternalAI={externalAI.openPasteDialog}
      onOpenModelSettings={() => modelSettingsOpenRef.current?.()}
      onTemplateSelect={onTemplateSelect}
      onCopySummary={onCopySummary}
    />
  );

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-white">
      {/* Title area */}
      <div className="min-w-0 shrink-0 border-b border-gray-200 p-3 sm:p-4">
        <div className="mb-3 flex flex-col gap-2">
          <EditableTitle
            title={meetingTitle}
            isEditing={isEditingTitle}
            onStartEditing={onStartEditTitle}
            onFinishEditing={onFinishEditTitle}
            onChange={onTitleChange}
          />
          <div className="flex flex-wrap items-center gap-1.5">
            <ProjectChips projects={projects} onRemove={onRemoveProject} />
            <ProjectPicker
              projects={availableProjects}
              assignedProjectIds={projects.map((project) => project.id)}
              onSelect={onAssignProject}
              onCreate={onCreateProject}
            />
          </div>
        </div>

        {/* Button groups - only show when summary exists */}
        {aiSummary && !isSummaryLoading && (
          <div className="min-w-0 pt-0">
            <div className="meeting-summary-actions-wide hidden min-w-0 flex-wrap items-center justify-center gap-2">
              {renderGenerator(true)}
              {renderUpdater(true)}
            </div>
            <div className="meeting-summary-actions-compact flex min-w-0 items-center justify-between gap-2">
              <div className="min-w-0">{renderGenerator(false)}</div>
              <div className="flex shrink-0 items-center gap-2">
                {renderUpdater(false)}
                {compactOverflow}
              </div>
            </div>
          </div>
        )}
      </div>

      {isSummaryLoading ? (
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
          {/* Show button group during generation */}
          <div className="shrink-0 px-3 pb-4 pt-6 sm:px-4 sm:pt-8">
            <div className="meeting-summary-actions-wide hidden justify-center">{renderGenerator(true, false)}</div>
            <div className="meeting-summary-actions-compact flex items-center justify-between gap-2">
              {renderGenerator(false, false)}
              {compactOverflow}
            </div>
          </div>
          {/* Loading spinner */}
          <div className="flex items-center justify-center flex-1">
            <div className="text-center">
              <div className="inline-block animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-blue-500 mb-4"></div>
              <p className="text-gray-600">Generating AI Summary...</p>
            </div>
          </div>
        </div>
      ) : !aiSummary ? (
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
          {/* Centered Summary Generator Button Group when no summary */}
          <div className="shrink-0 px-3 pb-4 pt-6 sm:px-4 sm:pt-8">
            <div className="meeting-summary-actions-wide hidden justify-center">{renderGenerator(true)}</div>
            <div className="meeting-summary-actions-compact flex items-center justify-between gap-2">
              {renderGenerator(false)}
              {compactOverflow}
            </div>
          </div>
          {/* Empty state message */}
          <EmptyStateSummary
            onGenerate={() => onGenerateSummary(customPrompt)}
            hasModel={modelConfig.provider !== null && modelConfig.model !== null}
            isGenerating={isSummaryLoading}
          />
        </div>
      ) : transcripts?.length > 0 && (
        <div className={RESPONSIVE_MARKDOWN_SUMMARY_CLASSES.scrollArea}>
          <div className="min-w-0 w-full max-w-full p-3 sm:p-6">
            <BlockNoteSummaryView
              ref={summaryRef}
              summaryData={aiSummary}
              onSave={onSaveSummary}
              onSummaryChange={onSummaryChange}
              onDirtyChange={onDirtyChange}
              status={summaryStatus}
              error={summaryError}
              onRegenerateSummary={() => {
                Analytics.trackButtonClick('regenerate_summary', 'meeting_details');
                onRegenerateSummary();
              }}
              meeting={{
                id: meeting.id,
                title: meetingTitle,
                created_at: meeting.created_at
              }}
            />
          </div>
          {summaryStatus !== 'idle' && (
            <div className={`mt-4 p-4 rounded-lg ${summaryStatus === 'error' ? 'bg-red-100 text-red-700' :
              summaryStatus === 'completed' ? 'bg-green-100 text-green-700' :
                'bg-blue-100 text-blue-700'
              }`}>
              <p className="text-sm font-medium">{getSummaryStatusMessage(summaryStatus)}</p>
            </div>
          )}
        </div>
      )}

      <Dialog open={externalAI.promptDialogOpen} onOpenChange={externalAI.setPromptDialogOpen}>
        <DialogContent className={`max-w-3xl ${RESPONSIVE_MARKDOWN_SUMMARY_CLASSES.dialog}`}>
          <DialogHeader>
            <DialogTitle>External AI Prompt</DialogTitle>
            <DialogDescription>
              Paste the copied prompt into ChatGPT, Claude, Gemini, or another AI tool. Then paste the Markdown result back into Meetily.
            </DialogDescription>
          </DialogHeader>

          <div className={`${RESPONSIVE_MARKDOWN_SUMMARY_CLASSES.dialogBody} space-y-4 pr-1`}>
            {externalAI.promptPackage?.warning && (
              <Alert>
                <AlertTitle>Long transcript split into parts</AlertTitle>
                <AlertDescription>
                  Copy each part into the external AI first, then copy the final merge prompt after you have the partial summaries.
                </AlertDescription>
              </Alert>
            )}

            {externalAI.promptPackage && externalAI.promptPackage.parts.length > 1 && (
              <div className="flex flex-wrap gap-2">
                {externalAI.promptPackage.parts.map((part, index) => (
                  <Button
                    key={part.title}
                    type="button"
                    variant={externalAI.selectedPromptIndex === index ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => externalAI.copyPromptPart(index)}
                  >
                    {part.title}
                  </Button>
                ))}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={externalAI.copyMergePrompt}
                >
                  Final merge prompt
                </Button>
              </div>
            )}

            <Textarea
              readOnly
              value={selectedExternalPrompt?.text ?? ''}
              className="min-h-[180px] max-w-full resize-y font-mono text-xs sm:min-h-[340px]"
            />
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => externalAI.setPromptDialogOpen(false)}
            >
              Close
            </Button>
            <Button
              type="button"
              onClick={() => externalAI.copyPromptPart(externalAI.selectedPromptIndex)}
              disabled={!selectedExternalPrompt}
            >
              Copy current prompt
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={externalAI.pasteDialogOpen} onOpenChange={externalAI.setPasteDialogOpen}>
        <DialogContent className={`max-w-3xl ${RESPONSIVE_MARKDOWN_SUMMARY_CLASSES.dialog}`}>
          <DialogHeader>
            <DialogTitle>Paste AI Result</DialogTitle>
            <DialogDescription>
              Paste the Markdown answer from your external AI. It will be saved as this meeting's notes.
            </DialogDescription>
          </DialogHeader>

          <div className={`${RESPONSIVE_MARKDOWN_SUMMARY_CLASSES.dialogBody} space-y-4 pr-1`}>
            {aiSummary && (
              <Alert>
                <AlertTitle>Existing notes will be replaced</AlertTitle>
                <AlertDescription>
                  This meeting already has notes. Confirm replacement before saving the pasted AI result.
                </AlertDescription>
              </Alert>
            )}

            <Textarea
              value={externalAI.pasteValue}
              onChange={(event) => externalAI.setPasteValue(event.target.value)}
              placeholder="Paste the external AI Markdown result here..."
              className="min-h-[180px] max-w-full resize-y font-mono text-sm sm:min-h-[320px]"
            />

            {aiSummary && (
              <label className="flex items-center gap-2 text-sm text-gray-700">
                <input
                  type="checkbox"
                  checked={externalAI.overwriteConfirmed}
                  onChange={(event) => externalAI.setOverwriteConfirmed(event.target.checked)}
                  className="h-4 w-4 rounded border-gray-300"
                />
                Replace existing meeting notes
              </label>
            )}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={externalAI.pasteFromClipboard}
            >
              Paste from Clipboard
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => externalAI.setPasteDialogOpen(false)}
              disabled={externalAI.isSavingPaste}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={externalAI.savePastedResult}
              disabled={externalAI.isSavingPaste || !externalAI.pasteValue.trim() || (!!aiSummary && !externalAI.overwriteConfirmed)}
            >
              {externalAI.isSavingPaste ? 'Saving...' : 'Save as Meeting Notes'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
