export function parseTrimTime(value: string): number | null {
  const match = value.trim().match(/^(\d{2,}):([0-5]\d):([0-5]\d(?:\.\d{1,3})?)$/);
  if (!match) return null;
  const seconds = Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
  return Number.isFinite(seconds) ? seconds : null;
}

export function formatTrimTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '';
  // Never round a prefilled end beyond the actual recording duration.
  const ms = Math.floor(seconds * 1000);
  const hours = Math.floor(ms / 3_600_000);
  const minutes = Math.floor(ms / 60_000) % 60;
  const wholeSeconds = Math.floor(ms / 1000) % 60;
  const fraction = ms % 1000;
  return [hours, minutes, wholeSeconds].map((part) => String(part).padStart(2, '0')).join(':')
    + (fraction ? `.${String(fraction).padStart(3, '0')}` : '');
}

export function getTrimRange(start: string, end: string, duration: number | null | undefined) {
  const startSeconds = parseTrimTime(start);
  const endSeconds = parseTrimTime(end);
  if (duration == null || !Number.isFinite(duration) || duration <= 0
    || startSeconds == null || endSeconds == null
    || startSeconds >= endSeconds || endSeconds > duration) return null;
  return { startSeconds, endSeconds, durationSeconds: endSeconds - startSeconds };
}
