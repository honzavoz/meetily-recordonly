'use client';

import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { Mic, Square, Video } from 'lucide-react';
import { useEffect, useMemo, useReducer } from 'react';

import {
  normalizeReminderError,
  ReminderOperationGate,
  ReminderPayload,
  reduceReminderState,
} from '@/lib/google-meet-reminder';

export default function GoogleMeetReminderPage() {
  const [state, dispatch] = useReducer(reduceReminderState, { kind: 'idle' });
  const gate = useMemo(() => new ReminderOperationGate(), []);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;

    listen<ReminderPayload>('google-meet-reminder-state', (event) => {
      dispatch({ type: 'payload', payload: event.payload });
    }).then((stopListening) => {
      if (disposed) stopListening();
      else unlisten = stopListening;
      return invoke('google_meet_reminder_ready');
    }).catch((error) => {
      dispatch({ type: 'failed', message: normalizeReminderError(error) });
    });

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  const run = (operation: () => Promise<unknown>) => {
    const pending = gate.run(async () => {
      dispatch({ type: 'running' });
      try {
        await operation();
      } catch (error) {
        dispatch({ type: 'failed', message: normalizeReminderError(error) });
      }
    });
    return pending;
  };

  const running = state.kind !== 'idle' && state.phase === 'running';
  const error = state.kind !== 'idle' && state.phase === 'error' ? state.message : undefined;

  return (
    <main className="fixed inset-0 z-[9999] flex select-none flex-col overflow-hidden bg-[#f7f8f5] text-slate-950">
      <div data-tauri-drag-region className="h-7 shrink-0" />
      <section className="flex flex-1 flex-col px-6 pb-5">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 rounded-xl bg-emerald-100 p-2.5 text-emerald-700">
            {state.kind === 'stop' ? <Square className="h-5 w-5" /> : <Video className="h-5 w-5" />}
          </div>
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-700">Record Only</p>
            <h1 className="mt-0.5 text-lg font-semibold leading-tight">
              {state.kind === 'stop' ? 'Google Meet ended' : state.kind === 'test' ? 'Reminder is working' : 'Google Meet is in progress'}
            </h1>
            <p className="mt-1 text-sm leading-snug text-slate-600">
              {state.kind === 'stop'
                ? 'Stop the recording and save it, or keep recording.'
                : state.kind === 'test'
                  ? 'Record Only can notify you when a call starts.'
                  : 'Start recording before the conversation gets underway.'}
            </p>
          </div>
        </div>

        {error && (
          <div className="mt-2 flex items-center justify-between gap-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">
            <p>{error}</p>
            <button
              onClick={() => run(() => invoke('open_meetily_from_reminder'))}
              className="shrink-0 font-semibold underline underline-offset-2"
            >
              Open Record Only
            </button>
          </div>
        )}

        <div className="mt-auto flex items-center justify-end gap-2">
          {state.kind === 'start' && (
            <>
              <button
                disabled={running}
                onClick={() => run(() => invoke('skip_google_meet_reminder', { sessionId: state.sessionId }))}
                className="rounded-lg px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-200/70 disabled:opacity-50"
              >
                Skip this call
              </button>
              <button
                disabled={running}
                onClick={() => run(() => invoke('start_google_meet_recording', { sessionId: state.sessionId }))}
                className="flex items-center gap-2 rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-emerald-800 disabled:opacity-60"
              >
                <Mic className="h-4 w-4" />
                {running ? 'Starting…' : error ? 'Try again' : 'Start recording'}
              </button>
            </>
          )}

          {state.kind === 'stop' && (
            <>
              <button
                disabled={running}
                onClick={() => run(() => invoke('keep_google_meet_recording', { sessionId: state.sessionId }))}
                className="rounded-lg px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-200/70 disabled:opacity-50"
              >
                Keep recording
              </button>
              <button
                disabled={running}
                onClick={() => run(() => invoke('stop_google_meet_recording', { sessionId: state.sessionId }))}
                className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
              >
                {running ? 'Saving…' : 'Stop and save'}
              </button>
            </>
          )}

          {state.kind === 'test' && (
            <button
              disabled={running}
              onClick={() => run(() => invoke('dismiss_google_meet_test_reminder'))}
              className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-60"
            >
              Got it
            </button>
          )}
        </div>
      </section>
    </main>
  );
}
