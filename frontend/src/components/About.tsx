import React, { useState } from 'react';
import Image from 'next/image';
import { invoke } from '@tauri-apps/api/core';
import { CheckCircle2, FileText, GitFork, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

import { UpdateDialog } from './UpdateDialog';
import { Button } from './ui/button';
import { useAppVersion } from '@/hooks/useAppVersion';
import { normalizeUpdaterError } from '@/lib/updater-flow';
import { updateService, UpdateInfo } from '@/services/updateService';

export function About() {
  const currentVersion = useAppVersion();
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [isChecking, setIsChecking] = useState(false);
  const [showUpdateDialog, setShowUpdateDialog] = useState(false);

  const handleCheckForUpdates = async () => {
    setIsChecking(true);
    try {
      const info = await updateService.checkForUpdates(true);
      setUpdateInfo(info);
      if (info.available) {
        setShowUpdateDialog(true);
      } else {
        toast.success('You are running the latest version');
      }
    } catch (error: unknown) {
      console.error('Failed to check for updates:', error);
      toast.error(
        'Failed to check for updates: ' + normalizeUpdaterError(error, 'Unknown error'),
      );
    } finally {
      setIsChecking(false);
    }
  };

  const handleOpenNotices = async () => {
    try {
      await invoke('open_legal_notices');
    } catch (error) {
      toast.error('Could not open license notices', { description: String(error) });
    }
  };

  const handleOpenPrivacyPolicy = async () => {
    try {
      await invoke('open_external_url', {
        url: 'https://github.com/honzavoz/meetily-recordonly/blob/main/PRIVACY_POLICY.md',
      });
    } catch (error) {
      toast.error('Could not open privacy policy', { description: String(error) });
    }
  };

  return (
    <div className="h-[80vh] space-y-4 overflow-y-auto p-4">
      <div className="text-center">
        <Image
          src="icon_128x128.png"
          alt="Record Only"
          width={64}
          height={64}
          className="mx-auto mb-3"
        />
        <h1 className="text-xl font-semibold text-gray-950">Record Only</h1>
        <p className="mt-1 text-xs font-medium text-gray-500">Version {currentVersion}</p>
        <p className="mt-2 text-sm text-gray-600">
          Private recording, transcription, and summaries on your Mac.
        </p>
      </div>

      <div className="rounded-lg border border-blue-100 bg-blue-50 p-4 text-left">
        <div className="flex gap-3">
          <GitFork className="mt-0.5 h-5 w-5 shrink-0 text-blue-700" aria-hidden="true" />
          <div className="space-y-2">
            <h2 className="text-sm font-semibold text-blue-950">Independent open-source fork</h2>
            <p className="text-xs leading-5 text-blue-900">
              Record Only is an independent fork of Meetily Community Edition, distributed under
              the MIT License. It is not endorsed by Zackriya Solutions.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" size="sm" onClick={handleOpenNotices}>
                <FileText className="mr-2 h-4 w-4" aria-hidden="true" />
                Open license notices
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleOpenPrivacyPolicy}
              >
                Privacy policy
              </Button>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <div className="rounded-lg bg-gray-50 p-3">
          <h2 className="mb-1 text-sm font-semibold text-gray-900">Local by default</h2>
          <p className="text-xs leading-5 text-gray-600">
            Recordings and local model processing stay on this Mac.
          </p>
        </div>
        <div className="rounded-lg bg-gray-50 p-3">
          <h2 className="mb-1 text-sm font-semibold text-gray-900">Your choice of AI</h2>
          <p className="text-xs leading-5 text-gray-600">
            Use bundled local models or connect a provider you choose.
          </p>
        </div>
      </div>

      <div className="flex justify-center">
        <Button
          onClick={handleCheckForUpdates}
          disabled={isChecking}
          variant="outline"
          size="sm"
        >
          {isChecking ? (
            <>
              <Loader2 className="mr-2 h-3 w-3 animate-spin" aria-hidden="true" />
              Checking...
            </>
          ) : (
            <>
              <CheckCircle2 className="mr-2 h-3 w-3" aria-hidden="true" />
              Check for updates
            </>
          )}
        </Button>
      </div>
      {updateInfo?.available && (
        <p className="text-center text-xs text-blue-600">Update available: v{updateInfo.version}</p>
      )}

      <UpdateDialog
        open={showUpdateDialog}
        onOpenChange={setShowUpdateDialog}
        updateInfo={updateInfo}
      />
    </div>
  );
}
