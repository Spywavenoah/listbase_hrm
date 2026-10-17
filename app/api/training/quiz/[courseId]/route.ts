import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { verifyEmployeeAuth } from '@/lib/training/auth';
import { canManageTraining } from '@/lib/training/server';
import { getQuizCourseSummary, loadQuizQuestions, saveQuizQuestions } from '@/lib/training/quiz-server';

export const runtime = 'nodejs';

/** Admin review: the full question set (including correct answers) + config. */
export async function GET(
  request: NextRequest,
  { params }: { params: { courseId: string } }
) {
  const auth = verifyEmployeeAuth(request);
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const db = createServerClient();
  if (!(await canManageTraining(db, auth.employeeId))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { data: courseData } = await db
    .from('training_courses')
    .select('id')
    .eq('id', params.courseId)
    .maybeSingle();
  if (!courseData) {
    return NextResponse.json({ error: 'Course not found' }, { status: 404 });
  }

  const [questions, summary] = await Promise.all([
    loadQuizQuestions(db, params.courseId, true),
    getQuizCourseSummary(db, params.courseId),
  ]);

  return NextResponse.json({ ok: true, questions, summary });
}

interface SaveBody {
  questions?: Array<{ prompt?: string; options?: string[]; correctIndex?: number; explanation?: string }>;
}

/** Admin edit: replace the question set with an explicit list (review / delete). */
export async function PUT(
  request: NextRequest,
  { params }: { params: { courseId: string } }
) {
  const auth = verifyEmployeeAuth(request);
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const db = createServerClient();
  if (!(await canManageTraining(db, auth.employeeId))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  let body: SaveBody;
  try {
    body = (await request.json()) as SaveBody;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const questions = (body.questions || [])
    .filter((q) => q && typeof q.prompt === 'string' && q.prompt.trim() && Array.isArray(q.options))
    .map((q) => ({
      prompt: String(q.prompt).trim(),
      options: (q.options || []).map((o) => String(o ?? '').trim()).filter((o) => o.length > 0),
      correctIndex: Number.isFinite(Number(q.correctIndex)) ? Math.max(0, Math.trunc(Number(q.correctIndex))) : 0,
      explanation: typeof q.explanation === 'string' ? q.explanation.trim() : undefined,
    }))
    .filter((q) => q.options.length >= 2);

  const saved = await saveQuizQuestions(db, params.courseId, questions, null);
  if (!saved.ok) {
    return NextResponse.json({ ok: false, code: saved.code || 'SAVE_FAILED' }, { status: 500 });
  }

  const [updated, summary] = await Promise.all([
    loadQuizQuestions(db, params.courseId, true),
    getQuizCourseSummary(db, params.courseId),
  ]);
  return NextResponse.json({ ok: true, count: saved.count, questions: updated, summary });
}
