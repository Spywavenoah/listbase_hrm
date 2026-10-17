import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { verifyEmployeeAuth, verifyProgressToken } from '@/lib/training/auth';
import { canInspect, loadEnrollment } from '@/lib/training/server';
import { submitQuizAnswers } from '@/lib/training/quiz-server';

export const runtime = 'nodejs';

interface SubmitBody {
  enrollmentId?: string;
  token?: string;
  answers?: Array<{ questionId?: string; selectedIndex?: number | null }>;
}

export async function POST(request: NextRequest) {
  const auth = verifyEmployeeAuth(request);
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: SubmitBody;
  try {
    body = (await request.json()) as SubmitBody;
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

  const answers = (body.answers || [])
    .filter((a) => a && typeof a.questionId === 'string' && a.questionId)
    .map((a) => ({
      questionId: String(a.questionId),
      selectedIndex:
        a.selectedIndex === null || a.selectedIndex === undefined || Number.isNaN(Number(a.selectedIndex))
          ? null
          : Math.trunc(Number(a.selectedIndex)),
    }));

  const result = await submitQuizAnswers(db, body.enrollmentId, answers);
  if (!result.ok) {
    const status = result.code === 'NOT_FOUND' ? 404 : result.code === 'NO_QUIZ' ? 400 : 500;
    return NextResponse.json({ ok: false, code: result.code || 'SUBMIT_FAILED' }, { status });
  }

  return NextResponse.json({
    ok: true,
    scorePct: result.scorePct,
    correctCount: result.correctCount,
    totalQuestions: result.totalQuestions,
    passed: result.passed,
    requiredPct: result.requiredPct,
    attemptNo: result.attemptNo,
    bestScorePct: result.bestScorePct,
    results: result.results,
  });
}
