'use client';

import React, { createContext, ReactNode, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { load } from '@tauri-apps/plugin-store';

const RECORD_ONLY_ANALYTICS_DISABLED_KEY = 'recordOnlyAnalyticsDisabledV1';

interface AnalyticsProviderProps {
  children: ReactNode;
}

interface AnalyticsContextType {
  isAnalyticsOptedIn: boolean;
  setIsAnalyticsOptedIn: (optedIn: boolean) => void;
}

export const AnalyticsContext = createContext<AnalyticsContextType>({
  isAnalyticsOptedIn: false,
  setIsAnalyticsOptedIn: () => {},
});

export default function AnalyticsProvider({ children }: AnalyticsProviderProps) {
  useEffect(() => {
    const disableLegacyAnalytics = async () => {
      const store = await load('analytics.json', {
        autoSave: false,
        defaults: { analyticsOptedIn: false },
      });

      await store.set('analyticsOptedIn', false);
      await store.set(RECORD_ONLY_ANALYTICS_DISABLED_KEY, true);
      await store.save();

      await invoke('disable_analytics').catch(() => undefined);
    };

    void disableLegacyAnalytics().catch((error) => {
      console.error('Failed to persist disabled analytics state:', error);
    });
  }, []);

  return (
    <AnalyticsContext.Provider
      value={{ isAnalyticsOptedIn: false, setIsAnalyticsOptedIn: () => {} }}
    >
      {children}
    </AnalyticsContext.Provider>
  );
}
