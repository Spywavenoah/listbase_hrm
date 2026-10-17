import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { verifyEmployeeAuth } from '@/lib/training/auth';
import { canManageTraining } from '@/lib/training/server';
import { getQuizCourseSummary, loadQuizQuestions, saveQuizQuestions } from '@/lib/training/quiz-server';
import { generateQuizFromVideo, QuizProviderError, quizProviderConfigured } from '@/lib/training/quiz-provider';

export const runtime = 'nodejs';
export const maxDuration = 300;

interface GenerateBody {
  courseId?: string;
  count?: number;
}

export async function POST(request: NextRequest) {
  const auth = verifyEmployeeAuth(request);
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const db = createServerClient();
  if (!(await canManageTraining(db, auth.employeeId))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  let body: GenerateBody;
  try {
    body = (await request.json()) as GenerateBody;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  if (!body?.courseId) {
    return NextResponse.json({ error: 'courseId is required' }, { status: 400 });
  }

  const { data: courseData } = await db
    .from('training_courses')
    .select('*')
    .eq('id', body.courseId)
    .maybeSingle();
  if (!courseData) {
    return NextResponse.json({ error: 'Course not found' }, { status: 404 });
  }
  const course = courseData as Record<string, unknown>;

  if (!course.video_path && !course.video_url) {
    return NextResponse.json(
      { ok: false, code: 'NO_VIDEO', error: 'This course has no lesson video to generate an assessment from.' },
      { status: 400 }
    );
  }

  if (!(await quizProviderConfigured(db))) {
    return NextResponse.json(
      {
        ok: false,
        code: 'NOT_CONFIGURED',
        error: 'No Gemini API key is configured. Add one under Settings → Company → GEMINI_API_KEY to generate assessment questions automatically.',
      },
      { status: 503 }
    );
  }

  const requested = Number(body.count ?? course.quiz_question_count ?? 10);
  const count = Math.max(1, Math.min(30, Number.isFinite(requested) ? Math.floor(requested) : 10));

  await db
    .from('training_courses')
    .update({ quiz_generation_status: 'PENDING', quiz_generation_error: null })
    .eq('id', body.courseId);

  try {
    const result = await generateQuizFromVideo(db, {
      courseId: body.courseId,
      title: String(course.title || 'Training Course'),
      category: (course.category as string) || null,
      count,
      videoPath: (course.video_path as string) || null,
      videoUrl: (course.video_url as string) || null,
      videoMimeType: (course.video_mime_type as string) || null,
    });

    const saved = await saveQuizQuestions(db, body.courseId, result.questions, result.model);
    if (!saved.ok) {
      await db
        .from('training_courses')
        .update({ quiz_generation_status: 'FAILED', quiz_generation_error: 'Questions could not be saved.' })
        .eq('id', body.courseId);
      return NextResponse.json({ ok: false, code: 'SAVE_FAILED', error: 'Questions could not be saved.' }, { status: 500 });
    }

    const questions = await loadQuizQuestions(db, body.courseId, true);
    const summary = await getQuizCourseSummary(db, body.courseId);
    return NextResponse.json({
      ok: true,
      provider: result.provider,
      model: result.model,
      count: saved.count,
      questions,
      summary,
    });
  } catch (e) {
    const err = e instanceof QuizProviderError ? e : null;
    const message = err?.message || (e instanceof Error ? e.message : 'Question generation failed.');
    await db
      .from('training_courses')
      .update({ quiz_generation_status: 'FAILED', quiz_generation_error: message.slice(0, 500) })
      .eq('id', body.courseId);

    const status = err?.code === 'NOT_CONFIGURED' ? 503 : err?.code === 'NO_VIDEO' ? 400 : 502;
    return NextResponse.json({ ok: false, code: err?.code || 'PROVIDER_ERROR', error: message }, { status });
  }
}
