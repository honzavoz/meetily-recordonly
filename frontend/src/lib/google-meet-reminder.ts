export type ReminderPayload =
  | { kind: 'start'; sessionId: string; attempt: number; message?: null }
  | { kind: 'stop'; sessionId: string; attempt?: null; message?: null }
  | { kind: 'error'; sessionId: string; attempt?: null; message: string }
  | { kind: 'test'; sessionId?: null; attempt?: null; message?: null };

export type ReminderState =
  | { kind: 'idle' }
  | { kind: 'test'; phase: 'ready' | 'running' | 'error'; message?: string }
  | {
      kind: 'start';
      phase: 'ready' | 'running' | 'error';
      sessionId: string;
      attempt: number;
      message?: string;
    }
  | {
      kind: 'stop';
      phase: 'ready' | 'running' | 'error';
      sessionId: string;
      message?: string;
    };

export type ReminderAction =
  | { type: 'running' }
  | { type: 'failed'; message: string }
  | { type: 'payload'; payload: ReminderPayload };

export function reduceReminderState(
  state: ReminderState,
  action: ReminderAction,
): ReminderState {
  if (action.type === 'payload') {
    const { payload } = action;
    if (payload.kind === 'test') return { kind: 'test', phase: 'ready' };
    if (payload.kind === 'stop') {
      return { kind: 'stop', phase: 'ready', sessionId: payload.sessionId };
    }
    if (payload.kind === 'error') {
      return {
        kind: 'start',
        phase: 'error',
        sessionId: payload.sessionId,
        attempt: 1,
        message: payload.message,
      };
    }
    return {
      kind: 'start',
      phase: 'ready',
      sessionId: payload.sessionId,
      attempt: payload.attempt,
    };
  }

  if (state.kind === 'idle') return state;
  if (action.type === 'running') return { ...state, phase: 'running', message: undefined };
  return { ...state, phase: 'error', message: action.message };
}

export class ReminderOperationGate {
  private active = false;

  run<T>(operation: () => Promise<T>): Promise<T> | null {
    if (this.active) return null;
    this.active = true;
    return operation().finally(() => {
      this.active = false;
    });
  }
}

export interface GoogleMeetIntegrationStatus {
  enabled: boolean;
  extensionPath: string | null;
  nativeHostRegistered: boolean;
  lastSeenAt: string | null;
}

export interface IntegrationSetupAction {
  visible: boolean;
  label: 'Install in Chrome' | 'Open Chrome Web Store';
}

export function integrationSetupAction(
  status: GoogleMeetIntegrationStatus,
): IntegrationSetupAction {
  const connected = integrationStatusLabel(status) === 'Connected';
  return {
    visible: !connected,
    label: status.extensionPath ? 'Open Chrome Web Store' : 'Install in Chrome',
  };
}

export function integrationStatusLabel(status: GoogleMeetIntegrationStatus): string {
  if (!status.extensionPath) return 'Not installed';
  if (status.enabled && status.nativeHostRegistered && status.lastSeenAt) return 'Connected';
  return 'Needs attention';
}

const START_SESSION_KEY = 'googleMeetStartSession';

export function storeGoogleMeetStart(storage: Storage, sessionId: string): void {
  storage.setItem(START_SESSION_KEY, sessionId);
}

export function consumeGoogleMeetStart(storage: Storage): string | null {
  const sessionId = storage.getItem(START_SESSION_KEY);
  storage.removeItem(START_SESSION_KEY);
  return sessionId;
}

export function normalizeReminderError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  if (error && typeof error === 'object' && 'message' in error) {
    return String(error.message);
  }
  return 'The operation failed. Please try again.';
}

export function isGoogleMeetReminderRoute(pathname: string): boolean {
  return pathname.replace(/\/$/, '') === '/google-meet-reminder';
}
