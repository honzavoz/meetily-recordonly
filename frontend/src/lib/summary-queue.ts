export type SummaryJobPhase =
  | 'reserved'
  | 'queued'
  | 'generating'
  | 'cancelling'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface SummaryJob {
  meetingId: string;
  jobId: string;
  phase: SummaryJobPhase;
  queuePosition: number | null;
  error: string | null;
}

export interface SummaryBackendStatus {
  meeting_id: string;
  process_id?: string | null;
  status: string;
  queue_position?: number | null;
  error?: string | null;
  data?: unknown;
  meetingName?: string | null;
  already_active?: boolean;
}

const normalizePhase = (status: string): SummaryJobPhase => {
  switch (status.trim().toLowerCase()) {
    case 'reserved':
      return 'reserved';
    case 'pending':
    case 'queued':
      return 'queued';
    case 'processing':
    case 'running':
    case 'summarizing':
    case 'regenerating':
      return 'generating';
    case 'cancelling':
      return 'cancelling';
    case 'cancelled':
      return 'cancelled';
    case 'failed':
    case 'error':
      return 'failed';
    case 'completed':
    case 'idle':
    default:
      return 'completed';
  }
};

export function toSummaryJob(response: SummaryBackendStatus): SummaryJob {
  return {
    meetingId: response.meeting_id,
    jobId: response.process_id ?? response.meeting_id,
    phase: normalizePhase(response.status),
    queuePosition: response.queue_position ?? null,
    error: response.error ?? null,
  };
}

export function upsertSummaryJob(
  state: Record<string, SummaryJob>,
  job: SummaryJob,
): Record<string, SummaryJob> {
  return {
    ...state,
    [job.meetingId]: job,
  };
}

export function isActiveSummaryJob(job?: SummaryJob): boolean {
  return job !== undefined && (
    job.phase === 'reserved'
    || job.phase === 'queued'
    || job.phase === 'generating'
    || job.phase === 'cancelling'
  );
}
