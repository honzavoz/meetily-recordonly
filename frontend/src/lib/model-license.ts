export interface ModelLicenseMetadata {
  modelName: string;
  displayName: string;
  licenseId: string;
  licenseUrl: string;
  sourceUrl: string;
  attribution: string;
  revision: string;
  downloadAvailable: boolean;
  unavailableReason?: string;
}

export interface ModelLicenseStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const qwenModels: Record<string, Pick<ModelLicenseMetadata, 'displayName' | 'sourceUrl'>> = {
  'qwen3.5:2b': {
    displayName: 'Qwen 3.5 2B',
    sourceUrl: 'https://huggingface.co/unsloth/Qwen3.5-2B-GGUF',
  },
  'qwen3.5:4b': {
    displayName: 'Qwen 3.5 4B',
    sourceUrl: 'https://huggingface.co/unsloth/Qwen3.5-4B-GGUF',
  },
};

const parakeetModels: Record<string, Pick<ModelLicenseMetadata, 'displayName' | 'sourceUrl' | 'attribution'>> = {
  'parakeet-tdt-0.6b-v3-int8': {
    displayName: 'NVIDIA Parakeet TDT 0.6B v3 (INT8)',
    sourceUrl: 'https://huggingface.co/istupakov/parakeet-tdt-0.6b-v3-onnx',
    attribution: 'NVIDIA Parakeet TDT 0.6B v3 model; ONNX conversion published by Igor Stupakov.',
  },
  'parakeet-tdt-0.6b-v2-int8': {
    displayName: 'NVIDIA Parakeet TDT 0.6B v2 (INT8)',
    sourceUrl: 'https://huggingface.co/istupakov/parakeet-tdt-0.6b-v2-onnx',
    attribution: 'NVIDIA Parakeet TDT 0.6B v2 model; ONNX conversion published by Igor Stupakov.',
  },
};

const whisperModels = new Set([
  'tiny',
  'base',
  'small',
  'medium',
  'large-v3-turbo',
  'large-v3',
  'tiny-q5_1',
  'base-q5_1',
  'small-q5_1',
  'medium-q5_0',
  'large-v3-turbo-q5_0',
  'large-v3-q5_0',
]);

export function getModelLicense(modelName: string): ModelLicenseMetadata | null {
  const qwen = qwenModels[modelName];
  if (qwen) {
    return {
      modelName,
      ...qwen,
      licenseId: 'Apache-2.0',
      licenseUrl: 'https://www.apache.org/licenses/LICENSE-2.0',
      attribution: `${qwen.displayName} model weights by the Qwen team; GGUF quantization distributed by Unsloth.`,
      revision: 'apache-2.0:qwen3.5:2026-02-16',
      downloadAvailable: true,
    };
  }

  const parakeet = parakeetModels[modelName];
  if (parakeet) {
    return {
      modelName,
      ...parakeet,
      licenseId: 'CC-BY-4.0',
      licenseUrl: 'https://creativecommons.org/licenses/by/4.0/legalcode',
      revision: `cc-by-4.0:${modelName}:2026-08-14`,
      downloadAvailable: true,
    };
  }

  if (whisperModels.has(modelName)) {
    return {
      modelName,
      displayName: `Whisper ${modelName}`,
      licenseId: 'MIT',
      licenseUrl: 'https://opensource.org/license/mit',
      sourceUrl: 'https://huggingface.co/ggerganov/whisper.cpp',
      attribution: 'OpenAI Whisper model weights converted to GGML format and distributed by the whisper.cpp project.',
      revision: 'mit:ggerganov-whisper.cpp:2026-08-14',
      downloadAvailable: true,
    };
  }

  if (modelName.startsWith('gemma3:')) {
    const isOneBillionParameterModel = modelName === 'gemma3:1b';
    return {
      modelName,
      displayName: isOneBillionParameterModel ? 'Gemma 3 1B' : 'Gemma 3 4B',
      licenseId: 'Gemma Terms of Use',
      licenseUrl: 'https://ai.google.dev/gemma/terms',
      sourceUrl: isOneBillionParameterModel
        ? 'https://huggingface.co/bartowski/google_gemma-3-1b-it-GGUF'
        : 'https://huggingface.co/bartowski/google_gemma-3-4b-it-GGUF',
      attribution: 'Google Gemma model weights; GGUF conversion previously offered by the application.',
      revision: 'gemma-terms:not-accepted',
      downloadAvailable: false,
      unavailableReason: 'New Gemma downloads are disabled until the current Gemma terms can be displayed and explicitly accepted.',
    };
  }

  return null;
}

function acceptanceKey(metadata: ModelLicenseMetadata): string {
  return `record-only:model-license:${metadata.modelName}:${metadata.revision}`;
}

export function isModelLicenseAccepted(modelName: string, storage: ModelLicenseStorage): boolean {
  const metadata = getModelLicense(modelName);
  if (!metadata?.downloadAvailable) return false;
  return storage.getItem(acceptanceKey(metadata)) === 'accepted';
}

export function acceptModelLicense(modelName: string, storage: ModelLicenseStorage): void {
  const metadata = getModelLicense(modelName);
  if (!metadata?.downloadAvailable) {
    throw new Error(metadata?.unavailableReason ?? `No reviewed license metadata exists for ${modelName}`);
  }
  storage.setItem(acceptanceKey(metadata), 'accepted');
}

export type LicensedDownloadResult = 'started' | 'declined' | 'unavailable';

export async function requestLicensedModelDownload(options: {
  modelName: string;
  storage: ModelLicenseStorage;
  requestAcceptance: (metadata: ModelLicenseMetadata) => Promise<boolean>;
  download: () => Promise<void>;
}): Promise<LicensedDownloadResult> {
  const { modelName, storage, requestAcceptance, download } = options;
  const metadata = getModelLicense(modelName);
  if (!metadata?.downloadAvailable) return 'unavailable';

  if (!isModelLicenseAccepted(modelName, storage)) {
    const accepted = await requestAcceptance(metadata);
    if (!accepted) return 'declined';
    acceptModelLicense(modelName, storage);
  }

  await download();
  return 'started';
}
