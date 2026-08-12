import { useState, useCallback, useEffect, useRef } from 'react';
import { Transcript, Summary } from '@/types';
import { ModelConfig } from '@/components/ModelSettingsModal';
import { CurrentMeeting, useSidebar } from '@/components/Sidebar/SidebarProvider';
import { invoke as invokeTauri } from '@tauri-apps/api/core';
import { toast } from 'sonner';
import Analytics from '@/lib/analytics';
import { isOllamaNotInstalledError } from '@/lib/utils';
import { BuiltInModelInfo } from '@/lib/builtin-ai';
import {
  detectAndCacheSummaryLanguage,
  readMeetingSummaryLanguage,
  readCachedDetectedSummaryLanguage,
} from '@/lib/summary-language-preferences';
import { isActiveSummaryJob, type SummaryBackendStatus } from '@/lib/summary-queue';

async function resolveSummaryLanguage(
  meetingId: string,
  transcriptTexts: string[]
): Promise<string | null> {
  try {
    const perMeeting = await readMeetingSummaryLanguage(meetingId);
    if (perMeeting.language) return perMeeting.language;
  } catch (err) {
    console.warn('Failed to load meeting summary language:', err);
    toast.warning('Could not load saved summary language', {
      description: 'Using Auto for this generation.',
    });
  }

  try {
    const cachedDetected = await readCachedDetectedSummaryLanguage(meetingId);
    if (cachedDetected) return cachedDetected;
  } catch (err) {
    console.warn('Failed to load cached detected summary language:', err);
  }

  try {
    const detection = await detectAndCacheSummaryLanguage(meetingId, transcriptTexts);
    if (detection.reason === 'tie') {
      toast.warning('Bilingual transcript detected', {
        description: 'Pick a summary language manually if Auto chooses the wrong fallback.',
      });
    }
    return detection.language;
  } catch (err) {
    console.warn('Failed to detect transcript summary language:', err);
    return null;
  }
}

type SummaryStatus = 'idle' | 'queued' | 'processing' | 'summarizing' | 'regenerating' | 'cancelling' | 'completed' | 'error';

interface UseSummaryGenerationProps {
  meeting: any;
  transcripts: Transcript[];
  modelConfig: ModelConfig;
  isModelConfigLoading: boolean;
  selectedTemplate: string;
  onMeetingUpdated?: () => Promise<void>;
  updateMeetingTitle: (title: string) => void;
  setAiSummary: (summary: Summary | null) => void;
  onOpenModelSettings?: () => void;
}

export function useSummaryGeneration({
  meeting,
  transcripts,
  modelConfig,
  isModelConfigLoading,
  selectedTemplate,
  onMeetingUpdated,
  updateMeetingTitle,
  setAiSummary,
  onOpenModelSettings,
}: UseSummaryGenerationProps) {
  const [summaryStatus, setSummaryStatus] = useState<SummaryStatus>('idle');
  const [summaryError, setSummaryError] = useState<string | null>(null);

  const {
    summaryJobs,
    trackSummaryJob,
    cancelSummaryJob,
  } = useSidebar();
  const activeJob = summaryJobs[meeting.id];
  const generationRequestInFlightRef = useRef(false);
  const handledTerminalJobIdRef = useRef<string | null>(null);
  const regenerationJobsRef = useRef(new Set<string>());

  useEffect(() => {
    handledTerminalJobIdRef.current = null;
    if (!activeJob) {
      setSummaryStatus('idle');
      setSummaryError(null);
    }
  }, [meeting.id]);

  // Helper to get status message
  const getSummaryStatusMessage = useCallback((status: SummaryStatus) => {
    switch (status) {
      case 'queued':
        return 'Queued for summary generation...';
      case 'processing':
        return 'Processing transcript...';
      case 'summarizing':
        return 'Generating summary...';
      case 'regenerating':
        return 'Regenerating summary...';
      case 'cancelling':
        return 'Cancelling summary generation...';
      case 'completed':
        return 'Summary completed';
      case 'error':
        return 'Error generating summary';
      default:
        return '';
    }
  }, []);

  // Unified summary processing logic
  const processSummary = useCallback(async ({
    transcriptText,
    transcriptTexts,
    customPrompt = '',
    isRegeneration = false,
  }: {
    transcriptText: string;
    transcriptTexts?: string[];
    customPrompt?: string;
    isRegeneration?: boolean;
  }) => {
    setSummaryStatus(isRegeneration ? 'regenerating' : 'processing');
    setSummaryError(null);

    try {
      if (!transcriptText.trim()) {
        throw new Error('No transcript text available. Please add some text first.');
      }

      console.log('Processing transcript with template:', selectedTemplate);

      // Resolve explicit metadata override first; Auto detects the transcript language.
      const summaryLanguage = await resolveSummaryLanguage(
        meeting.id,
        transcriptTexts?.length ? transcriptTexts : [transcriptText]
      );

      // Process transcript and get process_id
      const result = await invokeTauri('api_process_transcript', {
        text: transcriptText,
        model: modelConfig.provider,
        modelName: modelConfig.model,
        meetingId: meeting.id,
        chunkSize: 40000,
        overlap: 1000,
        customPrompt: customPrompt,
        templateId: selectedTemplate,
        summaryLanguage,
      }) as SummaryBackendStatus;

      trackSummaryJob(result);

      if (result.already_active) {
        toast.info('Summary generation is already queued', {
          description: result.queue_position
            ? `Current queue position: ${result.queue_position}`
            : 'The existing job is still active.',
        });
      } else {
        const timeSinceRecording = (
          Date.now() - new Date(meeting.created_at).getTime()
        ) / 60000;
        await Analytics.trackSummaryGenerationStarted(
          modelConfig.provider,
          modelConfig.model,
          transcriptText.length,
          timeSinceRecording,
        );
        if (customPrompt.trim().length > 0) {
          await Analytics.trackCustomPromptUsed(customPrompt.trim().length);
        }
        toast.info(`${isRegeneration ? 'Regenerating' : 'Generating'} summary...`, {
          description: result.queue_position
            ? `Queued at position ${result.queue_position}`
            : `Using ${modelConfig.provider}/${modelConfig.model}`,
          duration: 3000,
        });
      }

      const process_id = result.process_id;
      if (!process_id) throw new Error('Backend did not return a summary job ID');
      if (isRegeneration) regenerationJobsRef.current.add(process_id);
      console.log('Process ID:', process_id);

      // Global provider polling owns lifecycle updates across navigation.
    } catch (error) {
      console.error(`Failed to ${isRegeneration ? 'regenerate' : 'generate'} summary:`, error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      setSummaryError(errorMessage);
      setSummaryStatus('error');
      // Note: We don't clear the summary here because the backend has already restored from backup

      toast.error(`Failed to ${isRegeneration ? 'regenerate' : 'generate'} summary`, {
        description: errorMessage,
      });

      await Analytics.trackSummaryGenerationCompleted(
        modelConfig.provider,
        modelConfig.model,
        false,
        undefined,
        errorMessage
      );
    }
  }, [
    meeting.id,
    meeting.created_at,
    modelConfig,
    selectedTemplate,
    setAiSummary,
    updateMeetingTitle,
    onMeetingUpdated,
    trackSummaryJob,
  ]);

  useEffect(() => {
    if (!activeJob) return;

    if (activeJob.phase === 'reserved' || activeJob.phase === 'queued') {
      setSummaryStatus('queued');
      setSummaryError(activeJob.error);
      return;
    }
    if (activeJob.phase === 'generating') {
      setSummaryStatus('summarizing');
      setSummaryError(activeJob.error);
      return;
    }
    if (activeJob.phase === 'cancelling') {
      setSummaryStatus('cancelling');
      return;
    }
    if (handledTerminalJobIdRef.current === activeJob.jobId) return;

    let cancelled = false;
    const synchronizeTerminalSummary = async () => {
      let response: SummaryBackendStatus | null = null;
      let lastError: unknown = null;
      for (const delay of [0, 1000, 2500]) {
        if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
        if (cancelled) return;
        try {
          response = await invokeTauri<SummaryBackendStatus>('api_get_summary', {
            meetingId: meeting.id,
          });
          break;
        } catch (error) {
          lastError = error;
        }
      }

      if (!response) {
        if (cancelled) return;
        setSummaryStatus('error');
        setSummaryError(lastError instanceof Error ? lastError.message : String(lastError));
        return;
      }

      handledTerminalJobIdRef.current = activeJob.jobId;
      const wasRegeneration = regenerationJobsRef.current.delete(activeJob.jobId);

      try {
        if (response.data) setAiSummary(response.data as Summary);
        if (response.meetingName) updateMeetingTitle(response.meetingName);

        if (activeJob.phase === 'completed') {
          setSummaryStatus('completed');
          setSummaryError(null);
          toast.success('Summary generated successfully!', {
            description: 'Your meeting summary is ready',
            duration: 4000,
          });
          await Analytics.trackSummaryGenerationCompleted(
            modelConfig.provider,
            modelConfig.model,
            true,
          );
          await onMeetingUpdated?.();
        } else if (activeJob.phase === 'cancelled') {
          setSummaryStatus(response.data ? 'completed' : 'idle');
          setSummaryError(null);
        } else {
          setSummaryStatus('error');
          const errorMessage = activeJob.error || 'Summary generation failed';
          setSummaryError(errorMessage);
          toast.error(wasRegeneration ? 'Failed to regenerate summary' : 'Failed to generate summary', {
            description: response.data
              ? `${errorMessage}. Your previous summary has been restored.`
              : errorMessage,
          });
          await Analytics.trackSummaryGenerationCompleted(
            modelConfig.provider,
            modelConfig.model,
            false,
            undefined,
            errorMessage,
          );
        }
      } catch (error) {
        if (cancelled) return;
        setSummaryStatus('error');
        setSummaryError(error instanceof Error ? error.message : String(error));
      }
    };
    void synchronizeTerminalSummary();

    return () => {
      cancelled = true;
    };
  }, [
    activeJob,
    meeting.id,
    modelConfig.model,
    modelConfig.provider,
    onMeetingUpdated,
    setAiSummary,
    updateMeetingTitle,
  ]);

  // Helper function to fetch ALL transcripts for summary generation
  const fetchAllTranscripts = useCallback(async (meetingId: string): Promise<Transcript[]> => {
    try {
      console.log('📊 Fetching all transcripts for meeting:', meetingId);

      // First, get total count by fetching first page
      const firstPage = await invokeTauri('api_get_meeting_transcripts', {
        meetingId,
        limit: 1,
        offset: 0,
      }) as { transcripts: Transcript[]; total_count: number; has_more: boolean };

      const totalCount = firstPage.total_count;
      console.log(`📊 Total transcripts in database: ${totalCount}`);

      if (totalCount === 0) {
        return [];
      }

      // Fetch all transcripts in one call
      const allData = await invokeTauri('api_get_meeting_transcripts', {
        meetingId,
        limit: totalCount,
        offset: 0,
      }) as { transcripts: Transcript[]; total_count: number; has_more: boolean };

      console.log(`✅ Fetched ${allData.transcripts.length} transcripts from database`);
      return allData.transcripts;
    } catch (error) {
      console.error('❌ Error fetching all transcripts:', error);
      toast.error('Failed to fetch transcripts for summary generation');
      return [];
    }
  }, []);

  const buildSummaryTranscriptPayload = useCallback((allTranscripts: Transcript[]) => {
    const formatTime = (seconds: number | undefined, fallbackTimestamp: string): string => {
      if (seconds === undefined) {
        return fallbackTimestamp;
      }
      const totalSecs = Math.floor(seconds);
      const mins = Math.floor(totalSecs / 60);
      const secs = totalSecs % 60;
      return `[${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}]`;
    };

    return {
      transcriptText: allTranscripts
        .map(t => `${formatTime(t.audio_start_time, t.timestamp)} ${t.text}`)
        .join('\n'),
      transcriptTexts: allTranscripts.map(t => t.text),
    };
  }, []);

  // Public API: Generate summary from transcripts
  const prepareSummaryGeneration = useCallback(async (customPrompt: string = '') => {
    // Check if model config is still loading
    if (isModelConfigLoading) {
      console.log('⏳ Model configuration is still loading, please wait...');
      toast.info('Loading model configuration, please wait...');
      return;
    }

    // CHANGE: Fetch ALL transcripts from database, not from pagination state
    console.log('📊 Fetching all transcripts for summary generation...');
    const allTranscripts = await fetchAllTranscripts(meeting.id);

    if (!allTranscripts.length) {
      const error_msg = 'No transcripts available for summary';
      console.log(error_msg);
      toast.error(error_msg);
      return;
    }

    console.log(`✅ Proceeding with ${allTranscripts.length} transcripts`);

    console.log('🚀 Starting summary generation with config:', {
      provider: modelConfig.provider,
      model: modelConfig.model,
      template: selectedTemplate
    });

    // Check if Ollama provider has models available
    if (modelConfig.provider === 'ollama') {
      try {
        const endpoint = modelConfig.ollamaEndpoint || null;
        const models = await invokeTauri('get_ollama_models', { endpoint }) as any[];

        if (!models || models.length === 0) {
          toast.error(
            'No Ollama models found. Please download gemma3:1b from Model Settings.',
            { duration: 5000 }
          );
          return;
        }
      } catch (error) {
        console.error('Error checking Ollama models:', error);
        const errorMessage = error instanceof Error ? error.message : String(error);

        if (isOllamaNotInstalledError(errorMessage)) {
          // Ollama is not installed - show specific message with download link
          toast.error(
            'Ollama is not installed',
            {
              description: 'Please download and install Ollama to use local models.',
              duration: 7000,
              action: {
                label: 'Download',
                onClick: () => invokeTauri('open_external_url', { url: 'https://ollama.com/download' })
              }
            }
          );
        } else {
          // Other error - generic message
          toast.error(
            'Failed to check Ollama models. Please ensure Ollama is running and download a model from Settings.',
            { duration: 5000 }
          );
        }
        return;
      }
    }

    // Check if built-in AI provider has models available
    if (modelConfig.provider === 'builtin-ai') {
      try {
        const selectedModel = modelConfig.model;

        if (!selectedModel) {
          toast.error('No built-in AI model selected', {
            description: 'Please select a model in settings',
            duration: 5000,
          });
          if (onOpenModelSettings) {
            onOpenModelSettings();
          }
          return;
        }

        // Check model readiness with filesystem refresh
        const isReady = await invokeTauri<boolean>('builtin_ai_is_model_ready', {
          modelName: selectedModel,
          refresh: true,
        });

        if (!isReady) {
          // Get detailed model status
          const modelInfo = await invokeTauri<BuiltInModelInfo | null>('builtin_ai_get_model_info', {
            modelName: selectedModel,
          });

          if (modelInfo) {
            const status = modelInfo.status;

            if (status.type === 'downloading') {
              toast.info('Model download in progress', {
                description: `${selectedModel} is downloading (${status.progress}%). Please wait until download completes.`,
                duration: 5000,
              });
              return;
            }

            if (status.type === 'not_downloaded') {
              toast.error('Built-in AI model not downloaded', {
                description: `${selectedModel} needs to be downloaded. Please download it in model settings.`,
                duration: 7000,
              });
              if (onOpenModelSettings) {
                onOpenModelSettings();
              }
              return;
            }

            if (status.type === 'corrupted' || status.type === 'error') {
              const errorDesc = status.type === 'error'
                ? status.Error || 'The model file has an error'
                : 'The model file is corrupted';
              toast.error('Built-in AI model not available', {
                description: `${errorDesc}. Please check model settings.`,
                duration: 7000,
              });
              if (onOpenModelSettings) {
                onOpenModelSettings();
              }
              return;
            }
          }

          // Fallback if we couldn't get model info
          toast.error('Built-in AI model not ready', {
            description: 'Please ensure the model is downloaded in settings',
            duration: 5000,
          });
          if (onOpenModelSettings) {
            onOpenModelSettings();
          }
          return;
        }

        // Model is ready, continue to backend call
      } catch (error) {
        console.error('Error validating built-in AI model:', error);
        toast.error('Failed to validate built-in AI model', {
          description: error instanceof Error ? error.message : String(error),
          duration: 5000,
        });
        return;
      }
    }

    const summaryPayload = buildSummaryTranscriptPayload(allTranscripts);

    await processSummary({
      ...summaryPayload,
      customPrompt,
    });
  }, [meeting.id, fetchAllTranscripts, buildSummaryTranscriptPayload, processSummary, modelConfig, isModelConfigLoading, selectedTemplate]);

  const handleGenerateSummary = useCallback(async (customPrompt: string = '') => {
    if (generationRequestInFlightRef.current || isActiveSummaryJob(activeJob)) return;
    generationRequestInFlightRef.current = true;
    try {
      await prepareSummaryGeneration(customPrompt);
    } finally {
      generationRequestInFlightRef.current = false;
    }
  }, [activeJob, prepareSummaryGeneration]);

  // Public API: Regenerate summary from the current saved transcript
  const prepareSummaryRegeneration = useCallback(async () => {
    const allTranscripts = await fetchAllTranscripts(meeting.id);

    if (!allTranscripts.length) {
      console.error('No transcripts available for regeneration');
      toast.error('No transcripts available for summary regeneration');
      return;
    }

    await processSummary({
      ...buildSummaryTranscriptPayload(allTranscripts),
      isRegeneration: true
    });
  }, [meeting.id, fetchAllTranscripts, buildSummaryTranscriptPayload, processSummary]);

  const handleRegenerateSummary = useCallback(async () => {
    if (generationRequestInFlightRef.current || isActiveSummaryJob(activeJob)) return;
    generationRequestInFlightRef.current = true;
    try {
      await prepareSummaryRegeneration();
    } finally {
      generationRequestInFlightRef.current = false;
    }
  }, [activeJob, prepareSummaryRegeneration]);

  // Public API: Stop ongoing summary generation
  const handleStopGeneration = useCallback(async () => {
    console.log('Stopping summary generation for meeting:', meeting.id);

    if (!activeJob || !isActiveSummaryJob(activeJob)) return;

    try {
      const cancellationStatus = await cancelSummaryJob(meeting.id, activeJob.jobId);
      console.log('✓ Backend cancellation request sent for meeting:', meeting.id);
      if (cancellationStatus === 'not_active') {
        toast.info('Summary job is no longer active');
        return;
      }
      setSummaryStatus(activeJob.phase === 'queued' ? 'idle' : 'cancelling');
      setSummaryError(null);
      toast.info(
        activeJob.phase === 'queued'
          ? 'Queued summary cancelled'
          : 'Cancelling summary generation...',
      );
    } catch (error) {
      console.error('Failed to cancel summary generation:', error);
      toast.error('Failed to cancel summary generation', {
        description: error instanceof Error ? error.message : String(error),
      });
    }
  }, [activeJob, cancelSummaryJob, meeting.id]);

  return {
    summaryStatus,
    summaryQueuePosition: activeJob?.queuePosition ?? null,
    summaryError,
    handleGenerateSummary,
    handleRegenerateSummary,
    handleStopGeneration,
    getSummaryStatusMessage,
  };
}
