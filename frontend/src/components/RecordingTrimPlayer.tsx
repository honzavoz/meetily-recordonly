'use client';

import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Maximize2, Pause, Play, ZoomIn, ZoomOut } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { formatTrimTime, getTimelineWindow, moveTrimBoundary, type TimeRange } from '@/lib/recording-trim';

export interface RecordingTrimPlayerHandle {
  releaseAudio: () => void;
  reloadAudio: () => void;
}

interface Props {
  source: string;
  duration: number;
  selection: TimeRange;
  onSelectionChange: (range: TimeRange) => void;
  disabled: boolean;
  canPreview: boolean;
}

export const RecordingTrimPlayer = forwardRef<RecordingTrimPlayerHandle, Props>(function RecordingTrimPlayer({
  source, duration, selection, onSelectionChange, disabled, canPreview,
}, ref) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const timelineRef = useRef<HTMLDivElement>(null);
  const previewEnd = useRef<number | null>(null);
  const [position, setPosition] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [ready, setReady] = useState(false);
  const [playbackError, setPlaybackError] = useState<string | null>(null);
  const [view, setView] = useState<TimeRange>([0, duration]);
  const [selectionStart, selectionEnd] = selection;
  const span = view[1] - view[0];
  const percent = (time: number) => Math.max(0, Math.min(100, (time - view[0]) / span * 100));

  const releaseAudio = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.pause();
    audio.removeAttribute('src');
    audio.load();
    previewEnd.current = null;
    setPlaying(false);
    setReady(false);
  }, []);
  useImperativeHandle(ref, () => ({
    releaseAudio,
    reloadAudio: () => { if (audioRef.current) { audioRef.current.src = source; audioRef.current.load(); } },
  }), [source, releaseAudio]);

  useEffect(() => {
    const audio = audioRef.current;
    if (audio && audio.getAttribute('src') !== source) { audio.src = source; audio.load(); }
    return () => { if (audio) { audio.pause(); audio.removeAttribute('src'); audio.load(); } };
  }, [source]);

  useEffect(() => {
    if (previewEnd.current != null) {
      previewEnd.current = selectionEnd;
      const audio = audioRef.current;
      if (audio && (audio.currentTime < selectionStart || audio.currentTime >= selectionEnd)) audio.pause();
    }
  }, [selectionStart, selectionEnd]);

  const updatePosition = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (previewEnd.current != null && audio.currentTime >= previewEnd.current) {
      audio.pause();
      audio.currentTime = previewEnd.current;
      previewEnd.current = null;
    }
    setPosition(audio.currentTime);
  }, []);

  useEffect(() => {
    // WebKit can suspend animation frames when minimized. Pause selection
    // previews before that happens instead of playing beyond their end.
    const onVisibilityChange = () => {
      if (document.hidden && previewEnd.current != null) audioRef.current?.pause();
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => document.removeEventListener('visibilitychange', onVisibilityChange);
  }, []);

  useEffect(() => {
    if (!playing) return;
    let frame = 0;
    const tick = () => {
      updatePosition();
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, updatePosition]);

  const seek = (time: number) => {
    const target = Math.max(0, Math.min(duration, time));
    if (audioRef.current && ready) audioRef.current.currentTime = target;
    setPosition(target);
    previewEnd.current = null;
  };

  const play = async (selected = false) => {
    const audio = audioRef.current;
    if (!audio || !ready || disabled) return;
    setPlaybackError(null);
    if (!selected && !audio.paused) { audio.pause(); return; }
    previewEnd.current = selected ? selection[1] : null;
    if (selected) { audio.currentTime = selection[0]; setPosition(selection[0]); }
    else if (audio.ended || audio.currentTime >= duration) audio.currentTime = 0;
    try { await audio.play(); }
    catch { setPlaybackError('Could not play this recording. Reopen Trim to try again.'); }
  };

  const pointerTime = (clientX: number) => {
    const rect = timelineRef.current?.getBoundingClientRect();
    return rect ? view[0] + Math.max(0, Math.min(1, (clientX - rect.left) / rect.width)) * span : position;
  };

  const zoom = (scale: number) => setView(getTimelineWindow(duration, position, span * scale));
  const moveBoundary = (boundary: 'start' | 'end', time: number) => onSelectionChange(moveTrimBoundary(selection, boundary, time, duration));

  return (
    <div className="space-y-4">
      <audio ref={audioRef} src={source} preload="metadata"
        onLoadedMetadata={() => setReady(true)}
        onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)}
        onTimeUpdate={updatePosition}
        onError={() => { setReady(false); setPlaybackError('Could not load this recording for playback. Reopen Trim to try again.'); }}
      />
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" onClick={() => { void play(); }} disabled={!ready || disabled} className="min-w-24 gap-2">
          {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}{playing ? 'Pause' : 'Play'}
        </Button>
        <Button type="button" variant="ghost" size="icon" aria-label="Back 5 seconds" title="Back 5 seconds" disabled={!ready || disabled} onClick={() => seek(position - 5)}><ChevronLeft className="h-4 w-4" /></Button>
        <Button type="button" variant="ghost" size="icon" aria-label="Forward 5 seconds" title="Forward 5 seconds" disabled={!ready || disabled} onClick={() => seek(position + 5)}><ChevronRight className="h-4 w-4" /></Button>
        <span className="mr-auto text-sm tabular-nums text-gray-700" aria-label="Playback position">{formatTrimTime(position)} <span className="text-gray-400">/ {formatTrimTime(duration)}</span></span>
        <Button type="button" variant="outline" disabled={!ready || disabled || !canPreview} onClick={() => { void play(true); }} className="gap-2"><Play className="h-3.5 w-3.5" />Play selection</Button>
      </div>

      <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 pb-3 pt-5">
        <div ref={timelineRef} className="relative h-20" role="group" aria-label="Recording timeline">
          <div className="absolute inset-0 cursor-crosshair rounded outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
            role="slider" tabIndex={disabled ? -1 : 0} aria-label="Playback position" aria-valuemin={0} aria-valuemax={duration} aria-valuenow={position} aria-valuetext={formatTrimTime(position)} aria-disabled={disabled}
            onPointerDown={(event) => { if (!disabled && ready) seek(pointerTime(event.clientX)); }}
            onKeyDown={(event) => {
              if (disabled || !ready) return;
              if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') { event.preventDefault(); seek(position + (event.key === 'ArrowRight' ? 1 : -1) * (event.shiftKey ? 5 : 0.1)); }
              if (event.key === ' ') { event.preventDefault(); void play(); }
            }}>
            <div className="absolute inset-y-0 flex items-center justify-center overflow-hidden border-y border-blue-200 bg-blue-100/80" style={{ left: `${percent(selection[0])}%`, width: `${Math.max(0, percent(selection[1]) - percent(selection[0]))}%` }}>
              {percent(selection[1]) - percent(selection[0]) > 22 && <span className="whitespace-nowrap text-xs font-medium text-blue-700">Keep this section</span>}
            </div>
          </div>
          {(['start', 'end'] as const).map((boundary, index) => {
            const value = selection[index];
            if (value < view[0] || value > view[1]) return null;
            return <button key={boundary} type="button" role="slider" aria-label={boundary === 'start' ? 'Selection start' : 'Selection end'}
              aria-valuemin={boundary === 'start' ? 0 : selection[0]} aria-valuemax={boundary === 'start' ? selection[1] : duration} aria-valuenow={value} aria-valuetext={formatTrimTime(value)} disabled={disabled}
              className="absolute inset-y-0 z-10 -ml-2 flex w-4 touch-none items-center justify-center rounded border border-blue-700 bg-blue-600 text-white shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-blue-400 focus-visible:ring-offset-2 disabled:cursor-wait"
              style={{ left: `${percent(value)}%`, cursor: disabled ? 'wait' : 'ew-resize' }}
              onPointerDown={(event) => { event.preventDefault(); event.currentTarget.focus(); event.currentTarget.setPointerCapture(event.pointerId); }}
              onPointerMove={(event) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) moveBoundary(boundary, pointerTime(event.clientX)); }}
              onPointerUp={(event) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }}
              onKeyDown={(event) => {
                let time: number | null = null;
                if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') time = value + (event.key === 'ArrowRight' ? 1 : -1) * (event.shiftKey ? 1 : 0.1);
                if (event.key === 'Home') time = 0;
                if (event.key === 'End') time = duration;
                if (time != null) { event.preventDefault(); moveBoundary(boundary, time); }
              }}><span aria-hidden="true" className="h-6 border-l-2 border-white/80" /></button>;
          })}
          {position >= view[0] && position <= view[1] && <div className="pointer-events-none absolute inset-y-[-5px] z-20 w-px bg-gray-900" style={{ left: `${percent(position)}%` }}><span className="absolute -left-1 -top-1 h-2 w-2 rotate-45 bg-gray-900" /></div>}
        </div>
        <div className="mt-2 flex justify-between text-[11px] tabular-nums text-gray-500">{[0, 1, 2, 3, 4].map(i => <span key={i}>{formatTrimTime(view[0] + span * i / 4).split('.')[0]}</span>)}</div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs text-gray-500">Click to seek. Drag the blue handles to keep a section.</span>
          <div className="flex items-center gap-1">
            <Button type="button" variant="ghost" size="icon" aria-label="Move timeline earlier" title="Move timeline earlier" disabled={disabled || view[0] === 0} onClick={() => setView(getTimelineWindow(duration, (view[0] + view[1]) / 2 - span / 2, span))}><ChevronLeft className="h-4 w-4" /></Button>
            <Button type="button" variant="ghost" size="icon" aria-label="Zoom in at playhead" title="Zoom in at playhead" disabled={disabled || span <= Math.min(5, duration)} onClick={() => zoom(0.5)}><ZoomIn className="h-4 w-4" /></Button>
            <Button type="button" variant="ghost" size="icon" aria-label="Zoom out" title="Zoom out" disabled={disabled || span >= duration} onClick={() => zoom(2)}><ZoomOut className="h-4 w-4" /></Button>
            <Button type="button" variant="ghost" size="icon" aria-label="Show entire recording" title="Show entire recording" disabled={disabled || span >= duration} onClick={() => setView([0, duration])}><Maximize2 className="h-4 w-4" /></Button>
            <Button type="button" variant="ghost" size="icon" aria-label="Move timeline later" title="Move timeline later" disabled={disabled || view[1] >= duration} onClick={() => setView(getTimelineWindow(duration, (view[0] + view[1]) / 2 + span / 2, span))}><ChevronRight className="h-4 w-4" /></Button>
          </div>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" size="sm" disabled={!ready || disabled} onClick={() => moveBoundary('start', position)}>Set start here</Button>
        <Button type="button" variant="outline" size="sm" disabled={!ready || disabled} onClick={() => moveBoundary('end', position)}>Set end here</Button>
      </div>
      {playbackError && <p role="alert" className="text-sm text-red-600">{playbackError}</p>}
    </div>
  );
});
