'use client';

import { invoke } from '@tauri-apps/api/core';
import { Chrome, Loader2, TestTube2 } from 'lucide-react';
import { useEffect, useState } from 'react';

import {
  GoogleMeetIntegrationStatus,
  integrationStatusLabel,
  normalizeReminderError,
} from '@/lib/google-meet-reminder';
import { Switch } from './ui/switch';

export function GoogleMeetReminderSettings() {
  const [status, setStatus] = useState<GoogleMeetIntegrationStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    invoke<GoogleMeetIntegrationStatus>('get_google_meet_integration_status')
      .then(setStatus)
      .catch((reason) => setError(normalizeReminderError(reason)));
  }, []);

  const install = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      setStatus(await invoke<GoogleMeetIntegrationStatus>('install_google_meet_integration'));
    } catch (reason) {
      setError(normalizeReminderError(reason));
    } finally {
      setBusy(false);
    }
  };

  const toggle = async (enabled: boolean) => {
    if (!status || busy) return;
    const previous = status;
    setStatus({ ...status, enabled });
    setBusy(true);
    setError(null);
    try {
      setStatus(await invoke<GoogleMeetIntegrationStatus>('set_google_meet_integration_enabled', { enabled }));
    } catch (reason) {
      setStatus(previous);
      setError(normalizeReminderError(reason));
    } finally {
      setBusy(false);
    }
  };

  const testReminder = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await invoke('show_google_meet_test_reminder');
    } catch (reason) {
      setError(normalizeReminderError(reason));
    } finally {
      setBusy(false);
    }
  };

  const label = status ? integrationStatusLabel(status) : 'Checking…';
  const connected = label === 'Connected';

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
      <div className="flex items-start justify-between gap-5">
        <div className="flex min-w-0 gap-3">
          <div className="rounded-xl bg-emerald-50 p-2.5 text-emerald-700">
            <Chrome className="h-5 w-5" />
          </div>
          <div>
            <h3 className="text-lg font-semibold text-gray-900">Google Meet reminder</h3>
            <p className="mt-1 max-w-xl text-sm text-gray-600">
              Remind me to start recording when I join a Google Meet call in Chrome.
              Meetily receives only call start and end signals—never meeting content.
            </p>
          </div>
        </div>
        {status?.extensionPath && (
          <Switch
            checked={status.enabled}
            disabled={busy}
            onCheckedChange={toggle}
            aria-label="Enable Google Meet reminder"
          />
        )}
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-gray-100 pt-4">
        <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${connected ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>
          {label}
        </span>
        {!status?.extensionPath && (
          <button
            disabled={busy}
            onClick={install}
            className="rounded-md bg-gray-900 px-3 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-60"
          >
            Set up Chrome extension
          </button>
        )}
        {status?.extensionPath && (
          <button
            disabled={busy || !status.enabled}
            onClick={testReminder}
            className="flex items-center gap-2 rounded-md border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            <TestTube2 className="h-4 w-4" />
            Test reminder
          </button>
        )}
        {busy && <Loader2 className="h-4 w-4 animate-spin text-gray-500" />}
      </div>

      {status?.extensionPath && (
        <p className="mt-3 break-all text-xs text-gray-500">
          Chrome extension folder: {status.extensionPath}
        </p>
      )}
      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
    </div>
  );
}
