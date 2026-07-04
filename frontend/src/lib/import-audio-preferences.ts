export interface ImportAudioPreferences {
  language: string;
  modelKey: string | null;
}

const IMPORT_AUDIO_LANGUAGE_KEY = 'importAudioLanguage';
const IMPORT_AUDIO_MODEL_KEY = 'importAudioModelKey';

function storage(): Storage | null {
  if (typeof window === 'undefined') return null;
  return window.localStorage ?? null;
}

export function readImportAudioPreferences(
  fallbackLanguage: string | null | undefined = 'auto',
): ImportAudioPreferences {
  const store = storage();
  const fallback = fallbackLanguage || 'auto';
  if (!store) {
    return {
      language: fallback,
      modelKey: null,
    };
  }

  return {
    language: store.getItem(IMPORT_AUDIO_LANGUAGE_KEY) || fallback,
    modelKey: store.getItem(IMPORT_AUDIO_MODEL_KEY),
  };
}

export function saveImportAudioPreferences(preferences: ImportAudioPreferences): void {
  const store = storage();
  if (!store) return;

  store.setItem(IMPORT_AUDIO_LANGUAGE_KEY, preferences.language || 'auto');
  if (preferences.modelKey) {
    store.setItem(IMPORT_AUDIO_MODEL_KEY, preferences.modelKey);
  } else {
    store.removeItem(IMPORT_AUDIO_MODEL_KEY);
  }
}
