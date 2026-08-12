import React, { useEffect, useRef, useState } from 'react';
import { Download, AlertCircle, Loader2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './ui/dialog';
import { Button } from './ui/button';
import { updateService, UpdateInfo, UpdateProgress } from '@/services/updateService';
import { relaunch } from '@tauri-apps/plugin-process';
import { toast } from 'sonner';
import {
  normalizeUpdaterError,
  PreparedUpdateRetryState,
  resolvePreparedUpdate,
  type PreparedUpdate,
} from '@/lib/updater-flow';

interface UpdateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  updateInfo: UpdateInfo | null;
}

export function UpdateDialog({ open, onOpenChange, updateInfo }: UpdateDialogProps) {
  const [isDownloading, setIsDownloading] = useState(false);
  const [isPreparing, setIsPreparing] = useState(false);
  const [progress, setProgress] = useState<UpdateProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [update, setUpdate] = useState<PreparedUpdate | null>(null);
  const operationInFlightRef = useRef(false);
  const retryStateRef = useRef(new PreparedUpdateRetryState());

  useEffect(() => {
    if (operationInFlightRef.current) return;
    if (open && updateInfo?.available) {
      retryStateRef.current.reset();
      setIsDownloading(false);
      setIsPreparing(false);
      setProgress(null);
      setError(null);
      setUpdate(updateInfo.preparedUpdate ?? null);
    } else {
      setIsDownloading(false);
      setIsPreparing(false);
      setProgress(null);
      setError(null);
      setUpdate(null);
    }
  }, [open, updateInfo]);

  const handleDownloadAndInstall = async () => {
    if (operationInFlightRef.current) return;
    operationInFlightRef.current = true;
    let stage: 'prepare' | 'install' = 'prepare';
    let updateToUse: PreparedUpdate | null = null;
    let operationEntered = false;
    setError(null);
    setIsPreparing(!update);

    try {
      const preparedUpdate = await resolvePreparedUpdate(
        {
          available: Boolean(updateInfo?.available),
          preparedUpdate: retryStateRef.current.select(update, updateInfo?.preparedUpdate),
        },
        () => updateService.checkForUpdates(true),
      );
      updateToUse = preparedUpdate;
      retryStateRef.current.markPrepared(preparedUpdate);
      setUpdate(preparedUpdate);
      setIsPreparing(false);
      setIsDownloading(true);
      setProgress({ downloaded: 0, total: 0, percentage: 0 });
      stage = 'install';

      let downloaded = 0;
      let contentLength = 0;

      const started = await updateService.runUpdateOperation(preparedUpdate, async () => {
        operationEntered = true;
        await preparedUpdate.downloadAndInstall((event) => {
          switch (event.event) {
            case 'Started':
              contentLength = event.data.contentLength ?? 0;
              setProgress({ downloaded: 0, total: contentLength, percentage: 0 });
              break;
            case 'Progress': {
              downloaded += event.data.chunkLength;
              const percentage = contentLength > 0
                ? Math.round((downloaded / contentLength) * 100)
                : 0;
              setProgress({ downloaded, total: contentLength, percentage });
              break;
            }
            case 'Finished':
              setProgress({
                downloaded: contentLength,
                total: contentLength,
                percentage: 100,
              });
              break;
          }
        });

        toast.success('Update installed successfully. The app will restart...');
        setIsDownloading(false);
        onOpenChange(false);
        await relaunch();
      });

      if (!started) {
        throw new Error('Another update installation is already in progress');
      }
    } catch (cause: unknown) {
      console.error(`[UpdateDialog] ${stage} failed`, cause);
      if (updateToUse && operationEntered) {
        await updateService.discardPreparedUpdate(updateToUse);
      }
      retryStateRef.current.markFailed();
      setUpdate(null);
      const fallback = stage === 'prepare'
        ? 'Unable to prepare the update'
        : 'Unable to download or install the update';
      const message = normalizeUpdaterError(cause, fallback);
      setError(`${stage === 'prepare' ? 'Failed to prepare update' : 'Update failed'}: ${message}`);
      setIsPreparing(false);
      setIsDownloading(false);
      toast.error(message);
    } finally {
      operationInFlightRef.current = false;
    }
  };

  const formatDate = (dateString?: string) => {
    if (!dateString) return '';
    try {
      return new Date(dateString).toLocaleDateString();
    } catch {
      return dateString;
    }
  };

  const isBusy = isPreparing || isDownloading;

  const handleOpenChange = (newOpen: boolean) => {
    if (!newOpen && (operationInFlightRef.current || isBusy)) {
      return;
    }
    onOpenChange(newOpen);
  };

  const handleEscapeKeyDown = (event: KeyboardEvent) => {
    if (operationInFlightRef.current || isBusy) {
      event.preventDefault();
    }
  };

  const handleInteractOutside = (event: Event) => {
    if (operationInFlightRef.current || isBusy) {
      event.preventDefault();
    }
  };

  if (!updateInfo?.available) {
    return null;
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className="sm:max-w-[500px]"
        onEscapeKeyDown={handleEscapeKeyDown}
        onInteractOutside={handleInteractOutside}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {isBusy ? (
              <>
                <Loader2 className="h-5 w-5 animate-spin text-blue-600" />
                {isPreparing ? 'Preparing Update' : 'Downloading Update'}
              </>
            ) : error ? (
              <>
                <AlertCircle className="h-5 w-5 text-red-600" />
                Update Error
              </>
            ) : (
              <>
                <Download className="h-5 w-5 text-blue-600" />
                Update Available
              </>
            )}
          </DialogTitle>
          <DialogDescription>
            {isBusy
              ? isPreparing
                ? 'Preparing the latest version...'
                : 'Downloading the latest version...'
              : error
              ? 'An error occurred while updating'
              : `A new version (${updateInfo.version}) is available`}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {!isBusy && !error && (
            <>
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Current Version:</span>
                  <span className="font-medium">{updateInfo.currentVersion}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">New Version:</span>
                  <span className="font-medium text-blue-600">{updateInfo.version}</span>
                </div>
                {updateInfo.date && (
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Release Date:</span>
                    <span className="font-medium">{formatDate(updateInfo.date)}</span>
                  </div>
                )}
              </div>

              {updateInfo.body && (
                <div className="bg-gray-50 rounded-lg p-3 max-h-40 overflow-y-auto">
                  <p className="text-sm text-gray-700 whitespace-pre-wrap">
                    {updateInfo.body}
                  </p>
                </div>
              )}
            </>
          )}

          {isDownloading && progress && (
            <div className="space-y-2">
              <div className="relative">
                <div className="w-full bg-gray-200 rounded-full h-3">
                  <div
                    className="bg-blue-600 h-3 rounded-full transition-all duration-300 ease-out"
                    style={{ width: `${Math.min(progress.percentage, 100)}%` }}
                  />
                </div>
                <div className="flex justify-between text-xs text-gray-600 mt-1">
                  <span>{Math.round(progress.percentage)}% complete</span>
                  {progress.total > 0 && (
                    <span>
                      {formatBytes(progress.downloaded)} / {formatBytes(progress.total)}
                    </span>
                  )}
                </div>
              </div>
              <p className="text-sm text-muted-foreground text-center">
                The app will restart automatically after installation
              </p>
            </div>
          )}

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3">
              <p className="text-sm text-red-800">{error}</p>
            </div>
          )}
        </div>

        <DialogFooter>
          {!isBusy && !error && (
            <>
              <Button variant="outline" onClick={() => handleOpenChange(false)}>
                Later
              </Button>
              <Button onClick={handleDownloadAndInstall} className="bg-blue-600 hover:bg-blue-700">
                <Download className="h-4 w-4 mr-2" />
                Download & Install
              </Button>
            </>
          )}
          {error && !isBusy && (
            <>
              <Button variant="outline" onClick={() => handleOpenChange(false)}>
                Close
              </Button>
              <Button onClick={handleDownloadAndInstall} disabled={isBusy}>
                Try Again
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
}
