import type { WatchSegment } from './types';
import { SEGMENT_ADJACENCY_SEC } from './constants';

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

function finite(n: unknown): number | null {
  const v = typeof n === 'number' ? n : Number(n);
  return Number.isFinite(v) ? v : null;
}

/** Coerce arbitrary client input into a clean, ordered list of [start,end] seconds. */
export function normalizeSegments(raw: unknown): WatchSegment[] {
  if (!Array.isArray(raw)) return [];
  const out: WatchSegment[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const seg = item as Record<string, unknown>;
    let start = finite(seg.start);
    let end = finite(seg.end);
    if (start === null || end === null) continue;
    if (end < start) [start, end] = [end, start];
    if (end - start <= 0) continue;
    out.push({ start: round3(start), end: round3(end) });
  }
  return out;
}

/**
 * Union-merge two segment lists. Overlapping and near-adjacent segments
 * (within SEGMENT_ADJACENCY_SEC) collapse so replays/rewinds never
 * double-count and forward seeks never fabricate coverage.
 */
export function mergeSegments(a: unknown, b: unknown): WatchSegment[] {
  const all = [...normalizeSegments(a), ...normalizeSegments(b)];
  if (all.length === 0) return [];
  all.sort((x, y) => x.start - y.start || x.end - y.end);

  const merged: WatchSegment[] = [];
  for (const seg of all) {
    const last = merged[merged.length - 1];
    if (last && seg.start <= last.end + SEGMENT_ADJACENCY_SEC) {
      if (seg.end > last.end) last.end = round3(seg.end);
    } else {
      merged.push({ start: seg.start, end: seg.end });
    }
  }
  return merged;
}

/** Total distinct watched seconds, optionally clamped to the media duration. */
export function coverageSeconds(segments: unknown, duration?: number | null): number {
  const merged = mergeSegments(segments, []);
  const dur = duration && duration > 0 ? duration : null;
  let total = 0;
  for (const s of merged) {
    const end = dur ? Math.min(s.end, dur) : s.end;
    const start = Math.min(s.start, end);
    total += Math.max(0, end - start);
  }
  return round3(total);
}

export function coveragePct(segments: unknown, duration?: number | null): number {
  const dur = duration && duration > 0 ? duration : 0;
  if (!dur) return 0;
  return Math.min(100, (coverageSeconds(segments, dur) / dur) * 100);
}
