import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { verifyEmployeeAuth, verifyProgressToken } from '@/lib/training/auth';
import { canInspect, canViewCertificates, getEnforcement, hasCourseVideo, issueCertificate, loadEnrollment, renewalDaysLeft } from '@/lib/training/server';
import type { CompletionEvaluation } from '@/lib/training/types';

export const runtime = 'nodejs';

interface CompleteBody {
  enrollmentId?: string;
  token?: string;
}

export async function POST(request: NextRequest) {
  const auth = verifyEmployeeAuth(request);
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: CompleteBody;
  try {
    body = (await request.json()) as CompleteBody;
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

  const course = ctx.course;
  const video = hasCourseVideo(course);
  const enforcement = await getEnforcement(db);
  const validationEnabled = ctx.enrollment.validation_enabled !== false;
  const courseEnforced = course.completion_enforced !== false;

  const shouldEnforce = enforcement === 'ENFORCED' && video && validationEnabled && courseEnforced;
  const skipValidation = !shouldEnforce;

  const result = await issueCertificate(db, body.enrollmentId, skipValidation);

  if (!result.ok) {
    return NextResponse.json(
      {
        ok: false,
        code: result.code || 'NOT_ELIGIBLE',
        message: result.message || 'Completion criteria are not met.',
        enforced: shouldEnforce,
        reasons: (result.evaluation as CompletionEvaluation)?.reasons || [],
        evaluation: result.evaluation || null,
        quiz: result.quiz || null,
      },
      { status: 422 }
    );
  }

  // Certificates are locked by default — the PDF link is only revealed to
  // employees who hold the training.certificates privilege (or manage training).
  const showCert = await canViewCertificates(db, auth.employeeId);

  return NextResponse.json({
    ok: true,
    enforced: shouldEnforce,
    shadow: skipValidation,
    eligible: result.evaluation?.eligible === true,
    reasons: result.evaluation?.reasons || [],
    evaluation: result.evaluation || null,
    certificate: {
      certificateId: result.certificateId || null,
      issuedAt: result.issuedAt || null,
      expiresAt: result.expiresAt || null,
      pdfUrl: showCert ? (result.pdfUrl || null) : null,
      cycle: result.cycle || 1,
    },
    renewalDaysLeft: renewalDaysLeft(result.expiresAt || null),
    nextEnrollmentId: result.nextEnrollmentId || null,
  });
}
