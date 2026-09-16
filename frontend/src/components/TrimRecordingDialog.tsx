'use client';

import { useEffect, useRef, useState } from 'react';
import { convertFileSrc } from '@tauri-apps/api/core';
import { Loader2, Scissors } from 'lucide-react';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { formatTrimTime, getTrimRange, type TimeRange } from '@/lib/recording-trim';
import { RecordingTrimPlayer, type RecordingTrimPlayerHandle } from '@/components/RecordingTrimPlayer';
import { getTranscribeLaterTitle, type TranscribeLaterRecording } from '@/lib/transcribe-later';
import { transcribeLaterService } from '@/services/transcribeLaterService';

interface Props {
  recording: TranscribeLaterRecording;
  onClose: () => void;
  onRefresh: () => void;
}

export function TrimRecordingDialog({ recording, onClose, onRefresh }: Props) {
  const [start, setStart] = useState('00:00:00');
  const [end, setEnd] = useState('');
  const [duration, setDuration] = useState<number | null>(null);
  const [source, setSource] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submitting = useRef(false);
  const playerRef = useRef<RecordingTrimPlayerHandle>(null);
  const lastSelection = useRef<TimeRange>([0, 0]);

  useEffect(() => {
    let cancelled = false;
    transcribeLaterService.preparePreview(recording).then((preview) => {
      if (cancelled) return;
      const seconds = preview.durationSeconds;
      if (!Number.isFinite(seconds) || seconds <= 0) throw new Error('Could not read the recording duration.');
      setDuration(seconds);
      setEnd(formatTrimTime(seconds));
      lastSelection.current = [0, seconds];
      setSource(`${convertFileSrc(preview.audioPath)}?v=${recording.sizeBytes}-${recording.modifiedAtMs}`);
    }).catch((cause) => {
      if (!cancelled) setError(String(cause));
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [recording]);

  const range = getTrimRange(start, end, duration);
  const unchanged = range && range.startSeconds === 0 && end === formatTrimTime(duration!);
  useEffect(() => {
    const validRange = getTrimRange(start, end, duration);
    if (validRange) lastSelection.current = [validRange.startSeconds, validRange.endSeconds];
  }, [start, end, duration]);

  const save = async () => {
    if (!range || unchanged || submitting.current) return;
    submitting.current = true;
    setSaving(true);
    setError(null);
    // Release the native media file before replacing it (especially on Windows).
    playerRef.current?.releaseAudio();
    try {
      const result = await transcribeLaterService.trim(recording, range.startSeconds, range.endSeconds);
      toast.success('Recording trimmed', {
        description: `Saved ${formatTrimTime(result.durationSeconds)}. The original is backed up.`,
        action: {
          label: 'Open backup',
          onClick: () => { void transcribeLaterService.openFolder({ ...recording, folderPath: result.backupPath }).catch((cause) => toast.error('Could not open backup', { description: String(cause) })); },
        },
      });
      onRefresh();
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      // Refresh stale file snapshots so closing and reopening the dialog recovers.
      onRefresh();
      playerRef.current?.reloadAudio();
    } finally {
      submitting.current = false;
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !submitting.current) onClose(); }}>
      <DialogContent aria-busy={saving || loading} className="sm:max-w-[760px]" onEscapeKeyDown={(event) => { if (saving) event.preventDefault(); }} onPointerDownOutside={(event) => { if (saving) event.preventDefault(); }}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Scissors className="h-5 w-5" />Trim recording</DialogTitle>
          <DialogDescription className="break-words">{getTranscribeLaterTitle(recording)}</DialogDescription>
        </DialogHeader>
        <form onSubmit={(event) => { event.preventDefault(); void save(); }} className="space-y-4">
          {loading ? <p role="status" className="flex items-center gap-2 text-sm"><Loader2 className="h-4 w-4 animate-spin" />Reading recording…</p> : (
            <>
              {duration != null && source && <RecordingTrimPlayer ref={playerRef} source={source} duration={duration}
                selection={range ? [range.startSeconds, range.endSeconds] : lastSelection.current}
                canPreview={Boolean(range)} disabled={saving}
                onSelectionChange={([from, to]) => { setStart(formatTrimTime(from)); setEnd(formatTrimTime(to)); setError(null); }} />}
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <label htmlFor="trim-start" className="text-sm font-medium">Start</label>
                  <Input id="trim-start" value={start} disabled={saving || duration == null} onChange={(event) => { setStart(event.target.value); setError(null); }} placeholder="00:00:00" className="font-mono" aria-describedby="trim-time-help" autoFocus />
                </div>
                <div className="space-y-2">
                  <label htmlFor="trim-end" className="text-sm font-medium">End</label>
                  <Input id="trim-end" value={end} disabled={saving || duration == null} onChange={(event) => { setEnd(event.target.value); setError(null); }} placeholder="00:00:00" className="font-mono" aria-describedby="trim-time-help" />
                </div>
              </div>
              <p id="trim-time-help" className="text-xs text-gray-500">Fine-tune with hh:mm:ss. Milliseconds are optional.</p>
              <div className="text-sm text-gray-700" aria-live="polite">
                {range ? <>Keeping <strong className="tabular-nums">{formatTrimTime(range.durationSeconds)}</strong> of {formatTrimTime(duration!)}</> : 'Enter a start before the end, within the recording duration.'}
              </div>
            </>
          )}
          <p className="text-xs leading-relaxed text-gray-500">An original backup is saved in the recording folder. Audio quality is preserved; cuts may differ by a fraction of a second.</p>
          {error && <p role="alert" className="break-words text-sm text-red-600">{error}</p>}
          <DialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
            <Button type="submit" disabled={loading || saving || !range || Boolean(unchanged)}>
              {saving ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Trimming…</> : 'Save trimmed recording'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
