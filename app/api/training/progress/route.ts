import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { verifyEmployeeAuth, verifyProgressToken } from '@/lib/training/auth';
import { applyHeartbeat, canInspect, loadEnrollment } from '@/lib/training/server';
import type { HeartbeatPayload } from '@/lib/training/types';

export const runtime = 'nodejs';

const MAX_SEGMENTS = 600;

export async function POST(request: NextRequest) {
  const auth = verifyEmployeeAuth(request);
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: HeartbeatPayload;
  try {
    body = (await request.json()) as HeartbeatPayload;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (!body?.enrollmentId || !body?.token) {
    return NextResponse.json({ error: 'enrollmentId and token are required' }, { status: 400 });
  }

  const claims = verifyProgressToken(body.token, body.enrollmentId, auth.employeeId);
  if (!claims) {
    return NextResponse.json({ error: 'Invalid or expired progress token' }, { status: 403 });
  }

  const db = createServerClient();
  const ctx = await loadEnrollment(db, body.enrollmentId);
  if (!ctx) return NextResponse.json({ error: 'Enrollment not found' }, { status: 404 });

  const owner = String(ctx.enrollment.employee_id || '');
  if (!(await canInspect(db, auth.employeeId, owner))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const payload: HeartbeatPayload = {
    ...body,
    enrollmentId: body.enrollmentId,
    sessionId: claims.sessionId || body.sessionId,
    position: Math.max(0, Number(body.position) || 0),
    duration: Math.max(0, Number(body.duration) || 0),
    playbackRate: Math.max(0.1, Math.min(Number(body.playbackRate) || 1, 8)),
    sinceLastMs: Math.max(0, Math.min(Number(body.sinceLastMs) || 0, 10 * 60 * 1000)),
    segments: Array.isArray(body.segments) ? body.segments.slice(0, MAX_SEGMENTS) : [],
    interrupted: Boolean(body.interrupted),
    playing: Boolean(body.playing),
    fingerprint: String(body.fingerprint || '').slice(0, 128),
    clientTs: body.clientTs || new Date().toISOString(),
  };

  try {
    const res = await applyHeartbeat(db, body.enrollmentId, payload);
    return NextResponse.json({
      ok: true,
      progressPct: res.progressPct,
      state: res.state,
      eligible: res.eligible,
      reasons: res.evaluation.reasons || [],
      evaluation: res.evaluation,
      summary: {
        watchDurationSeconds: Number(res.progress.watch_duration_seconds),
        maxPositionSeconds: Number(res.progress.max_position_seconds),
        heartbeatCount: res.progress.heartbeat_count,
        expectedHeartbeats: res.progress.expected_heartbeats,
        maxGapMs: res.progress.max_gap_ms,
        maxPlaybackRate: Number(res.progress.max_playback_rate),
        fingerprintMismatch: res.progress.fingerprint_mismatch,
      },
    });
  } catch (e) {
    console.error('progress heartbeat failed:', e);
    return NextResponse.json({ error: (e as Error).message || 'Failed to record progress' }, { status: 500 });
  }
}
