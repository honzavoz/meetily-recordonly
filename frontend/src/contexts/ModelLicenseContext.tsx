'use client';

import React, { createContext, useCallback, useContext, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { ExternalLink, FileCheck2, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  getModelLicense,
  requestLicensedModelDownload,
  type LicensedDownloadResult,
  type ModelLicenseMetadata,
} from '@/lib/model-license';

interface PendingAcceptance {
  metadata: ModelLicenseMetadata;
  resolve: (accepted: boolean) => void;
}

type RequestModelDownload = (
  modelName: string,
  download: () => Promise<void>,
) => Promise<LicensedDownloadResult>;

const ModelLicenseContext = createContext<RequestModelDownload | null>(null);

export function ModelLicenseProvider({ children }: { children: React.ReactNode }) {
  const [queue, setQueue] = useState<PendingAcceptance[]>([]);
  const pending = queue[0];

  const requestAcceptance = useCallback((metadata: ModelLicenseMetadata) => (
    new Promise<boolean>((resolve) => {
      setQueue(current => [...current, { metadata, resolve }]);
    })
  ), []);

  const resolveCurrent = useCallback((accepted: boolean) => {
    setQueue(current => {
      const [currentRequest, ...remaining] = current;
      if (currentRequest) {
        queueMicrotask(() => currentRequest.resolve(accepted));
      }
      return remaining;
    });
  }, []);

  const requestModelDownload = useCallback<RequestModelDownload>(async (modelName, download) => {
    const metadata = getModelLicense(modelName);
    if (!metadata?.downloadAvailable) {
      toast.error('Model download unavailable', {
        description: metadata?.unavailableReason ?? `No reviewed license metadata exists for ${modelName}.`,
      });
      return 'unavailable';
    }

    return requestLicensedModelDownload({
      modelName,
      storage: window.localStorage,
      requestAcceptance,
      download,
    });
  }, [requestAcceptance]);

  const openExternal = useCallback(async (url: string) => {
    try {
      await invoke('open_external_url', { url });
    } catch (error) {
      toast.error('Could not open the link', { description: String(error) });
    }
  }, []);

  return (
    <ModelLicenseContext.Provider value={requestModelDownload}>
      {children}
      <Dialog open={Boolean(pending)} onOpenChange={(open) => !open && resolveCurrent(false)}>
        <DialogContent
          className="max-w-lg overflow-hidden border-slate-200 p-0 shadow-2xl"
        >
          {pending ? (
            <>
              <div className="border-b border-blue-100 bg-gradient-to-br from-blue-50 via-white to-cyan-50 px-6 pb-5 pt-6">
                <div className="mb-4 flex items-center gap-3">
                  <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-blue-600 text-white shadow-sm">
                    <ShieldCheck className="h-6 w-6" aria-hidden="true" />
                  </span>
                  <span className="rounded-full border border-blue-200 bg-white px-3 py-1 text-xs font-semibold tracking-wide text-blue-700">
                    {pending.metadata.licenseId}
                  </span>
                </div>
                <DialogHeader className="space-y-2 text-left">
                  <DialogTitle className="text-xl text-slate-950">
                    Review before downloading
                  </DialogTitle>
                  <DialogDescription className="text-sm leading-6 text-slate-600">
                    {pending.metadata.displayName} is downloaded from a third party and stored locally on this device.
                  </DialogDescription>
                </DialogHeader>
              </div>

              <div className="space-y-4 px-6 py-5">
                <div className="grid gap-3 sm:grid-cols-2">
                  <button
                    type="button"
                    onClick={() => openExternal(pending.metadata.sourceUrl)}
                    className="group flex min-h-20 items-start justify-between rounded-xl border border-slate-200 bg-slate-50 p-4 text-left transition-colors hover:border-blue-300 hover:bg-blue-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                  >
                    <span>
                      <span className="block text-xs font-semibold uppercase tracking-wider text-slate-500">Model source</span>
                      <span className="mt-1 block text-sm font-medium text-slate-900">View repository</span>
                    </span>
                    <ExternalLink className="h-4 w-4 text-slate-400 transition-colors group-hover:text-blue-600" aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    onClick={() => openExternal(pending.metadata.licenseUrl)}
                    className="group flex min-h-20 items-start justify-between rounded-xl border border-slate-200 bg-slate-50 p-4 text-left transition-colors hover:border-blue-300 hover:bg-blue-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                  >
                    <span>
                      <span className="block text-xs font-semibold uppercase tracking-wider text-slate-500">License terms</span>
                      <span className="mt-1 block text-sm font-medium text-slate-900">Read {pending.metadata.licenseId}</span>
                    </span>
                    <ExternalLink className="h-4 w-4 text-slate-400 transition-colors group-hover:text-blue-600" aria-hidden="true" />
                  </button>
                </div>

                <div className="flex gap-3 rounded-xl border border-slate-200 bg-white p-4">
                  <FileCheck2 className="mt-0.5 h-5 w-5 shrink-0 text-blue-600" aria-hidden="true" />
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Attribution</p>
                    <p className="mt-1 text-sm leading-6 text-slate-700">{pending.metadata.attribution}</p>
                  </div>
                </div>

                <p className="text-xs leading-5 text-slate-500">
                  Your acceptance is saved for this exact model and license revision. Updated terms will require a new review.
                </p>
              </div>

              <DialogFooter className="border-t border-slate-100 bg-slate-50 px-6 py-4 sm:justify-between">
                <Button type="button" variant="outline" onClick={() => resolveCurrent(false)}>
                  Cancel
                </Button>
                <Button type="button" onClick={() => resolveCurrent(true)} className="bg-blue-600 hover:bg-blue-700">
                  Accept and download
                </Button>
              </DialogFooter>
            </>
          ) : (
            <DialogDescription className="sr-only">
              Model license review dialog.
            </DialogDescription>
          )}
        </DialogContent>
      </Dialog>
    </ModelLicenseContext.Provider>
  );
}

export function useModelLicenseDownload(): RequestModelDownload {
  const context = useContext(ModelLicenseContext);
  if (!context) {
    throw new Error('useModelLicenseDownload must be used within ModelLicenseProvider');
  }
  return context;
}
