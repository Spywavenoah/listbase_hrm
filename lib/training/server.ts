import { createServerClient } from '@/lib/supabase/server';
import {
  CERT_BUCKET,
  COMPLETION_ENFORCEMENT_KEY,
  DEFAULT_HEARTBEAT_INTERVAL_SEC,
  DEFAULT_PASS_PCT,
  TRAINING_SETTINGS_GROUP,
  VIDEO_BUCKET,
  type EnforcementMode,
} from './constants';
import { coveragePct, coverageSeconds, mergeSegments, normalizeSegments } from './segments';
import { renderCertificatePdf } from './certificate';
import type { CompletionEvaluation, HeartbeatPayload, TrainingProgress, WatchSegment } from './types';

export type Db = ReturnType<typeof createServerClient>;

export interface EnrollmentContext {
  enrollment: Record<string, unknown>;
  course: Record<string, unknown>;
  progress: TrainingProgress | null;
}

const emptyProgress = (enrollmentId: string): TrainingProgress => ({
  enrollment_id: enrollmentId,
  watched_segments: [],
  last_position_seconds: 0,
  last_heartbeat_at: null,
  watch_duration_seconds: 0,
  duration_seconds: null,
  heartbeat_count: 0,
  expected_heartbeats: 0,
  max_position_seconds: 0,
  max_playback_rate: 1,
  max_gap_ms: 0,
  session_id: null,
  device_fingerprint: null,
  fingerprint_mismatch: false,
  completion_state: 'IN_PROGRESS',
  decision: null,
});

function parseSetting(raw: unknown): string {
  if (typeof raw === 'string') {
    const t = raw.trim();
    if (!t) return '';
    try {
      const parsed = JSON.parse(t);
      return typeof parsed === 'string' ? parsed : t;
    } catch {
      return t.replace(/^"|"$/g, '');
    }
  }
  return '';
}

export async function getEnforcement(db: Db): Promise<EnforcementMode> {
  const { data } = await db
    .from('system_settings')
    .select('value')
    .eq('group_name', TRAINING_SETTINGS_GROUP)
    .eq('key', COMPLETION_ENFORCEMENT_KEY)
    .maybeSingle();
  return parseSetting(data?.value) === 'ENFORCED' ? 'ENFORCED' : 'SHADOW';
}

/**
 * Consumption guard: only the enrollment OWNER may watch, heartbeat, quiz or
 * complete an enrollment. Admins explicitly may NOT act on someone else's
 * enrollment (they retain read-only compliance visibility via the Enrollments
 * page, which reads the table directly under RLS).
 */
export async function canInspect(db: Db, employeeId: string, ownerEmployeeId: string): Promise<boolean> {
  return Boolean(employeeId && employeeId === ownerEmployeeId);
}

/** True when the employee may manage training content (super admin or training.manage). */
export async function canManageTraining(db: Db, employeeId: string): Promise<boolean> {
  if (!employeeId) return false;
  const { data: emp } = await db.from('employees').select('role').eq('id', employeeId).maybeSingle();
  if (emp?.role === 'SUPER_ADMIN') return true;
  const { data: grants } = await db
    .from('employee_privileges')
    .select('privilege_key')
    .eq('employee_id', employeeId)
    .eq('privilege_key', 'training.manage')
    .limit(1);
  return Boolean(grants && grants.length > 0);
}

/**
 * Certificates are locked down by default: no employee may access a certificate
 * (personal or organisation-wide) unless they hold the `training.certificates`
 * privilege, manage training, or are a super admin.
 */
export async function canViewCertificates(db: Db, employeeId: string): Promise<boolean> {
  if (!employeeId) return false;
  const { data: emp } = await db.from('employees').select('role').eq('id', employeeId).maybeSingle();
  if (emp?.role === 'SUPER_ADMIN') return true;
  const { data: grants } = await db
    .from('employee_privileges')
    .select('privilege_key')
    .eq('employee_id', employeeId)
    .in('privilege_key', ['training.certificates', 'training.manage']);
  return Boolean(grants && grants.length > 0);
}

export async function loadEnrollment(db: Db, enrollmentId: string): Promise<EnrollmentContext | null> {
  const { data, error } = await db
    .from('training_enrollments')
    .select('*, training_courses(*)')
    .eq('id', enrollmentId)
    .maybeSingle();
  if (error || !data) return null;
  const row = data as Record<string, unknown> & { training_courses?: Record<string, unknown> | null };
  const course = row.training_courses || {};
  delete (row as Record<string, unknown>).training_courses;

  const { data: progress } = await db
    .from('training_video_progress')
    .select('*')
    .eq('enrollment_id', enrollmentId)
    .maybeSingle();

  return { enrollment: row, course, progress: (progress as TrainingProgress | null) ?? null };
}

function durationFor(course: Record<string, unknown>, observed: number | null): number {
  const configured = Number(course.video_duration_seconds || 0);
  if (configured > 0) return configured;
  if (observed && observed > 0) return observed;
  return 0;
}

/** A course has a verifiable lesson when it has a source (upload or URL) and a known duration. */
export function hasCourseVideo(course: Record<string, unknown>): boolean {
  const hasSource = Boolean(course.video_path) || Boolean(course.video_url);
  return hasSource && Number(course.video_duration_seconds || 0) > 0;
}

/** Resolve the playable lesson URL: uploaded object first, then the legacy URL. */
export function courseVideoUrl(db: Db, course: Record<string, unknown>): string | null {
  const path = (course.video_path as string) || '';
  if (path) {
    const { data } = db.storage.from(VIDEO_BUCKET).getPublicUrl(path);
    if (data?.publicUrl) return data.publicUrl;
  }
  return (course.video_url as string) || null;
}

export interface ApplyResult {
  progress: TrainingProgress;
  evaluation: CompletionEvaluation;
  eligible: boolean;
  state: string;
  progressPct: number;
}

/**
 * Persist one heartbeat: merge watched segments, fold in rate / gap / position
 * facts, then ask the authoritative SQL evaluator for the completion decision.
 */
export async function applyHeartbeat(db: Db, enrollmentId: string, payload: HeartbeatPayload): Promise<ApplyResult> {
  const ctx = await loadEnrollment(db, enrollmentId);
  if (!ctx) throw new Error('Enrollment not found');

  const existing = ctx.progress ?? emptyProgress(enrollmentId);
  const observedDuration = Number(payload.duration || 0) > 0 ? Number(payload.duration) : null;
  const duration = durationFor(ctx.course, observedDuration);

  const segments: WatchSegment[] = mergeSegments(existing.watched_segments, normalizeSegments(payload.segments));
  const coverage = coverageSeconds(segments, duration);
  const pct = duration > 0 ? coveragePct(segments, duration) : 0;

  const nowIso = new Date().toISOString();
  const sessionChanged = Boolean(existing.session_id && existing.session_id !== payload.sessionId);

  // ---- gap: only continuous, uninterrupted playback counts against the gap cap
  const { data: lastRow } = await db
    .from('training_video_heartbeats')
    .select('server_ts, interrupted, session_id')
    .eq('enrollment_id', enrollmentId)
    .order('server_ts', { ascending: false })
    .limit(1)
    .maybeSingle();

  let gap = 0;
  if (!payload.interrupted) {
    let clientGap = Number(payload.sinceLastMs || 0);
    if (sessionChanged) clientGap = 0;
    let serverGap = 0;
    if (lastRow && !sessionChanged && !lastRow.interrupted) {
      const lastTs = new Date(lastRow.server_ts).getTime();
      if (Number.isFinite(lastTs)) serverGap = Math.max(0, Date.now() - lastTs);
    }
    gap = Math.max(clientGap, serverGap);
  }

  // ---- device fingerprint binding (first seen wins; later change is flagged)
  let fingerprint = existing.device_fingerprint || '';
  let fingerprintMismatch = existing.fingerprint_mismatch;
  const incoming = (payload.fingerprint || '').trim();
  if (!fingerprint) fingerprint = incoming;
  else if (incoming && incoming !== fingerprint) fingerprintMismatch = true;

  const maxRate = Math.max(Number(existing.max_playback_rate) || 1, Number(payload.playbackRate) || 1);
  const maxPosition = Math.max(Number(existing.max_position_seconds) || 0, Number(payload.position) || 0);
  const maxGap = Math.max(Number(existing.max_gap_ms) || 0, gap);
  const expected = duration > 0 ? Math.ceil(duration / DEFAULT_HEARTBEAT_INTERVAL_SEC) : 0;

  const progress: TrainingProgress = {
    enrollment_id: enrollmentId,
    watched_segments: segments,
    last_position_seconds: Number(payload.position) || 0,
    last_heartbeat_at: nowIso,
    watch_duration_seconds: coverage,
    duration_seconds: duration > 0 ? duration : (existing.duration_seconds ?? null),
    heartbeat_count: Number(existing.heartbeat_count || 0) + 1,
    expected_heartbeats: expected,
    max_position_seconds: maxPosition,
    max_playback_rate: maxRate,
    max_gap_ms: maxGap,
    session_id: payload.sessionId,
    device_fingerprint: fingerprint || null,
    fingerprint_mismatch: fingerprintMismatch,
    completion_state: existing.completion_state,
    decision: existing.decision,
  };

  const { error: upsertErr } = await db
    .from('training_video_progress')
    .upsert(progress, { onConflict: 'enrollment_id' });
  if (upsertErr) throw new Error(upsertErr.message);

  await db.from('training_video_heartbeats').insert({
    enrollment_id: enrollmentId,
    session_id: payload.sessionId,
    device_fingerprint: fingerprint || null,
    position_seconds: Number(payload.position) || 0,
    playback_rate: maxRate,
    playing: Boolean(payload.playing),
    interrupted: Boolean(payload.interrupted),
    since_last_ms: Number(payload.sinceLastMs) || 0,
    client_ts: payload.clientTs || nowIso,
  });

  const evaluation = await evaluate(db, enrollmentId);
  const eligible = evaluation.eligible === true;
  const reasons = evaluation.reasons || [];
  const cheat = reasons.some((r) => r === 'playback_rate' || r === 'max_gap_ms' || r === 'fingerprint_mismatch');
  const state = eligible ? 'ELIGIBLE' : cheat ? 'BLOCKED' : 'IN_PROGRESS';

  await db.from('training_video_progress').update({ completion_state: state, decision: evaluation }).eq('enrollment_id', enrollmentId);

  const enrollmentState =
    String(ctx.enrollment.status || '') === 'COMPLETED'
      ? 'ISSUED'
      : state;
  await db
    .from('training_enrollments')
    .update({
      progress: Math.round(pct),
      completion_state: enrollmentState,
      completion_decision: evaluation,
      updated_at: nowIso,
    })
    .eq('id', enrollmentId);

  return { progress, evaluation, eligible, state, progressPct: Math.round(pct) };
}

/** Authoritative completion decision — computed by SQL from stored data. */
export async function evaluate(db: Db, enrollmentId: string): Promise<CompletionEvaluation> {
  const { data, error } = await db.rpc('training_completion_evaluation', {
    p_enrollment_id: enrollmentId,
  });
  if (error) return { ok: false, error: error.message };
  return (data as CompletionEvaluation) ?? { ok: false, error: 'No evaluation' };
}

export interface IssueResult {
  ok: boolean;
  code?: string;
  message?: string;
  certificateId?: string | null;
  issuedAt?: string | null;
  expiresAt?: string | null;
  pdfUrl?: string | null;
  nextEnrollmentId?: string | null;
  cycle?: number;
  evaluation?: CompletionEvaluation;
  skippedValidation?: boolean;
  quiz?: Record<string, unknown>;
}

export async function issueCertificate(
  db: Db,
  enrollmentId: string,
  skipValidation: boolean
): Promise<IssueResult> {
  const ctx = await loadEnrollment(db, enrollmentId);
  if (!ctx) return { ok: false, code: 'NOT_FOUND', message: 'Enrollment not found' };

  const evaluation = await evaluate(db, enrollmentId);
  // shadow / non-video / validation disabled -> log without blocking.
  // enforced -> let SQL refuse when the criteria are not met.
  const effectiveSkip = skipValidation;

  const { data, error } = await db.rpc('issue_training_certificate', {
    p_enrollment_id: enrollmentId,
    p_skip_validation: effectiveSkip,
  });
  if (error) return { ok: false, code: 'RPC_ERROR', message: error.message };

  const res = (data ?? {}) as Record<string, unknown> & { ok?: boolean };
  if (!res.ok) {
    return {
      ok: false,
      code: res.code ? String(res.code) : 'NOT_ELIGIBLE',
      message: res.message ? String(res.message) : 'Completion criteria are not met.',
      evaluation,
      skippedValidation: effectiveSkip,
      quiz: (res.quiz as Record<string, unknown>) || undefined,
    };
  }

  const certificateId = String(res.certificate_id ?? '');
  const expiresAt = res.certificate_expires_at ? String(res.certificate_expires_at) : null;
  const issuedAt = res.certificate_issued_at ? String(res.certificate_issued_at) : null;

  let pdfUrl: string | null = res.certificate_pdf_url ? String(res.certificate_pdf_url) : null;
  if (certificateId) {
    try {
      pdfUrl = await uploadCertificatePdf(db, {
        employeeId: String(ctx.enrollment.employee_id || ''),
        certificateId,
        employeeName: await employeeName(db, String(ctx.enrollment.employee_id || '')),
        courseTitle: String(ctx.course.title || 'Training Course'),
        instructor: (ctx.course.instructor as string) || null,
        issuedAt: new Date(issuedAt || Date.now()),
        expiresAt: expiresAt ? new Date(expiresAt) : null,
        cycle: Number(res.cycle || ctx.enrollment.cycle || 1),
      });
      if (pdfUrl) {
        await db.from('training_enrollments').update({ certificate_pdf_url: pdfUrl }).eq('id', enrollmentId);
      }
    } catch (e) {
      console.error('certificate pdf failed:', e);
    }
  }

  return {
    ok: true,
    certificateId: certificateId || null,
    issuedAt,
    expiresAt,
    pdfUrl,
    nextEnrollmentId: res.next_enrollment_id ? String(res.next_enrollment_id) : null,
    cycle: Number(res.cycle || 1),
    evaluation,
    skippedValidation: effectiveSkip,
  };
}

async function employeeName(db: Db, employeeId: string): Promise<string> {
  const { data } = await db
    .from('employees')
    .select('first_name, last_name')
    .eq('id', employeeId)
    .maybeSingle();
  if (!data) return '';
  return `${data.first_name || ''} ${data.last_name || ''}`.trim();
}

async function uploadCertificatePdf(
  db: Db,
  input: {
    employeeId: string;
    certificateId: string;
    employeeName: string;
    courseTitle: string;
    instructor: string | null;
    issuedAt: Date;
    expiresAt: Date | null;
    cycle: number;
  }
): Promise<string | null> {
  const buf = renderCertificatePdf({
    certificateId: input.certificateId,
    employeeName: input.employeeName || 'Employee',
    courseTitle: input.courseTitle,
    instructor: input.instructor,
    issuedAt: input.issuedAt,
    expiresAt: input.expiresAt,
    cycle: input.cycle,
  });
  const path = `${input.employeeId}/training-${input.certificateId}.pdf`;
  const { error } = await db.storage.from(CERT_BUCKET).upload(path, buf, {
    contentType: 'application/pdf',
    upsert: true,
  });
  if (error) throw new Error(error.message);
  const { data } = db.storage.from(CERT_BUCKET).getPublicUrl(path);
  return data?.publicUrl ?? null;
}

export function renewalDaysLeft(expiresAt: string | null | undefined): number | null {
  if (!expiresAt) return null;
  const ms = new Date(expiresAt).getTime() - Date.now();
  if (!Number.isFinite(ms)) return null;
  return Math.ceil(ms / (1000 * 60 * 60 * 24));
}

export function defaultPassPct(course: Record<string, unknown>): number {
  const v = Number(course.pass_pct);
  return Number.isFinite(v) && v > 0 ? v : DEFAULT_PASS_PCT;
}
