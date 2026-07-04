import { beforeEach, describe, expect, test } from "bun:test";

function installLocalStorage() {
  const values = new Map<string, string>();

  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      localStorage: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => {
          values.set(key, value);
        },
        removeItem: (key: string) => {
          values.delete(key);
        },
      },
    },
  });

  return values;
}

describe("import audio preferences", () => {
  beforeEach(() => {
    installLocalStorage();
  });

  test("defaults to the configured transcription language when no import preference exists", async () => {
    const prefs = await import("../../src/lib/import-audio-preferences");

    expect(prefs.readImportAudioPreferences("cs")).toEqual({
      language: "cs",
      modelKey: null,
    });
  });

  test("persists last import language and model", async () => {
    const prefs = await import("../../src/lib/import-audio-preferences");

    prefs.saveImportAudioPreferences({
      language: "en",
      modelKey: "whisper:ggml-large-v3.bin",
    });

    expect(prefs.readImportAudioPreferences("cs")).toEqual({
      language: "en",
      modelKey: "whisper:ggml-large-v3.bin",
    });
  });
});
