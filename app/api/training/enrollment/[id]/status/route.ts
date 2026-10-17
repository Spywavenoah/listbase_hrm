import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { newSessionId, signProgressToken, verifyEmployeeAuth } from '@/lib/training/auth';
import { canInspect, courseVideoUrl, evaluate, getEnforcement, hasCourseVideo, loadEnrollment, renewalDaysLeft } from '@/lib/training/server';
import { coveragePct } from '@/lib/training/segments';
import { HEARTBEAT_INTERVAL_MS, type CompletionState, type EnforcementMode } from '@/lib/training/constants';
import type { CertificateInfo, CompletionEvaluation } from '@/lib/training/types';

export const runtime = 'nodejs';

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const auth = verifyEmployeeAuth(request);
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const db = createServerClient();
  const ctx = await loadEnrollment(db, params.id);
  if (!ctx) return NextResponse.json({ error: 'Enrollment not found' }, { status: 404 });

  const owner = String(ctx.enrollment.employee_id || '');
  if (!(await canInspect(db, auth.employeeId, owner))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const course = ctx.course;
  const progress = ctx.progress;
  const enforcement: EnforcementMode = await getEnforcement(db);
  const video = hasCourseVideo(course);
  const validationEnabled = ctx.enrollment.validation_enabled !== false;
  const courseEnforced = course.completion_enforced !== false;
  const enforced = enforcement === 'ENFORCED' && video && validationEnabled && courseEnforced;

  const evaluation: CompletionEvaluation = video
    ? await evaluate(db, params.id)
    : { ok: true, has_video: false, eligible: true, reasons: [] };

  const duration =
    Number(course.video_duration_seconds || 0) ||
    Number(progress?.duration_seconds || 0) ||
    0;

  const pct = duration > 0
    ? Math.min(100, Math.round(coveragePct(progress?.watched_segments ?? [], duration)))
    : Number(ctx.enrollment.progress || 0);

  const sessionId = newSessionId();
  const certificate: CertificateInfo = {
    certificateId: (ctx.enrollment.certificate_id as string) || null,
    issuedAt: (ctx.enrollment.certificate_issued_at as string) || null,
    expiresAt: (ctx.enrollment.certificate_expires_at as string) || null,
    pdfUrl: (ctx.enrollment.certificate_pdf_url as string) || null,
    cycle: Number(ctx.enrollment.cycle || 1),
  };

  return NextResponse.json({
    enrollmentId: params.id,
    courseId: String(ctx.enrollment.course_id || ''),
    employeeId: owner,
    courseTitle: String(course.title || 'Training Course'),
    instructor: (course.instructor as string) || null,
    status: String(ctx.enrollment.status || 'ENROLLED'),
    completionState: (ctx.enrollment.completion_state as CompletionState) || 'IN_PROGRESS',
    cycle: Number(ctx.enrollment.cycle || 1),
    progressPct: pct,
    resumePosition: Number(progress?.last_position_seconds || 0),
    durationSeconds: duration,
    videoUrl: courseVideoUrl(db, course),
    passPct: Number(course.pass_pct || 95),
    renewalMonths: (course.renewal_months as number) ?? null,
    enforcement,
    enforced,
    validationEnabled,
    hasVideo: video,
    evaluation,
    eligible: evaluation.eligible === true,
    reasons: evaluation.reasons || [],
    certificate,
    renewalDaysLeft: renewalDaysLeft(certificate.expiresAt),
    progressToken: signProgressToken(params.id, auth.employeeId, sessionId),
    sessionId,
    heartbeatIntervalMs: HEARTBEAT_INTERVAL_MS,
  });
}
