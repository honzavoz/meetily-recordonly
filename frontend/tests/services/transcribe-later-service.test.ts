import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { TranscribeLaterRecording } from "@/lib/transcribe-later";

const invokeMock = mock(async () => undefined);

mock.module("@tauri-apps/api/core", () => ({
  invoke: invokeMock,
}));

const { TranscribeLaterService } = await import("@/services/transcribeLaterService");

const recording = (): TranscribeLaterRecording => ({
  id: "/recordings/Meeting 2026-07-04_17-55-31/audio.mp4",
  title: "Meeting 2026-07-04_17-55-31",
  folderPath: "/recordings/Meeting 2026-07-04_17-55-31",
  audioPath: "/recordings/Meeting 2026-07-04_17-55-31/audio.mp4",
  sizeBytes: 1200,
  modifiedAtMs: 1_788_017_731_000,
  durationSeconds: 120,
  status: "pending",
  projects: [],
});

describe("TranscribeLaterService", () => {
  beforeEach(() => {
    invokeMock.mockClear();
  });

  test("opens a pending recording audio file for preview", async () => {
    const service = new TranscribeLaterService();
    const pendingRecording = recording();

    await service.play(pendingRecording);

    expect(invokeMock).toHaveBeenCalledWith("play_transcribe_later_recording", {
      audioPath: pendingRecording.audioPath,
    });
  });

  test("deletes the whole pending recording folder", async () => {
    const service = new TranscribeLaterService();
    const pendingRecording = recording();

    await service.delete(pendingRecording);

    expect(invokeMock).toHaveBeenCalledWith("delete_transcribe_later_recording", {
      folderPath: pendingRecording.folderPath,
      audioPath: pendingRecording.audioPath,
    });
  });

  test("renames a pending recording folder", async () => {
    const service = new TranscribeLaterService();
    const pendingRecording = recording();

    await service.rename(pendingRecording, "Client kickoff");

    expect(invokeMock).toHaveBeenCalledWith("rename_transcribe_later_recording", {
      folderPath: pendingRecording.folderPath,
      audioPath: pendingRecording.audioPath,
      title: "Client kickoff",
    });
  });

  test("assigns and removes a project from recording metadata", async () => {
    const service = new TranscribeLaterService();
    const pendingRecording = recording();

    await service.assignProject(pendingRecording, "project-1");
    expect(invokeMock).toHaveBeenLastCalledWith("assign_transcribe_later_recording_project", {
      folderPath: pendingRecording.folderPath,
      projectId: "project-1",
    });

    await service.removeProject(pendingRecording, "project-1");
    expect(invokeMock).toHaveBeenLastCalledWith("remove_transcribe_later_recording_project", {
      folderPath: pendingRecording.folderPath,
      projectId: "project-1",
    });
  });

  test("transfers projects to the imported meeting", async () => {
    const service = new TranscribeLaterService();
    const pendingRecording = recording();

    await service.transferProjects(pendingRecording, "meeting-1");

    expect(invokeMock).toHaveBeenCalledWith("transfer_transcribe_later_recording_projects", {
      folderPath: pendingRecording.folderPath,
      meetingId: "meeting-1",
    });
  });
});
