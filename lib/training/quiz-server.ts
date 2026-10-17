import type { Db } from './server';
import type { QuizAdminQuestion, QuizQuestionPublic } from './types';

interface QuizRow {
  id: string;
  prompt: string;
  options: unknown;
  correct_index: number;
  explanation: string | null;
  position: number;
}

function asOptions(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.map((o) => String(o ?? ''));
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed.map((o) => String(o ?? ''));
    } catch {
      /* ignore */
    }
  }
  return [];
}

/** Question list for a course. Answers are stripped unless the caller is an admin. */
export async function loadQuizQuestions(
  db: Db,
  courseId: string,
  withAnswers: boolean
): Promise<QuizAdminQuestion[] | QuizQuestionPublic[]> {
  const { data } = await db
    .from('training_quiz_questions')
    .select('id, prompt, options, correct_index, explanation, position')
    .eq('course_id', courseId)
    .order('position', { ascending: true });
  const rows = (data as QuizRow[] | null) || [];
  if (withAnswers) {
    return rows.map((r) => ({
      id: r.id,
      prompt: r.prompt,
      options: asOptions(r.options),
      position: r.position,
      correctIndex: r.correct_index,
      explanation: r.explanation,
    }));
  }
  return rows.map((r) => ({
    id: r.id,
    prompt: r.prompt,
    options: asOptions(r.options),
    position: r.position,
  }));
}

export interface QuizSaveResult {
  ok: boolean;
  count: number;
  code?: string;
}

/** Replace a course's question set (used by the admin generate/regenerate flow). */
export async function saveQuizQuestions(
  db: Db,
  courseId: string,
  questions: Array<{ prompt: string; options: string[]; correctIndex: number; explanation?: string }>,
  model: string | null
): Promise<QuizSaveResult> {
  const { data, error } = await db.rpc('set_training_quiz', {
    p_course_id: courseId,
    p_questions: questions,
    p_model: model,
  });
  if (error) return { ok: false, count: 0, code: 'RPC_ERROR' };
  const res = (data ?? {}) as { ok?: boolean; count?: number; code?: string };
  return { ok: res.ok === true, count: Number(res.count || 0), code: res.code };
}

export interface QuizSubmitResult {
  ok: boolean;
  code?: string;
  scorePct: number;
  correctCount: number;
  totalQuestions: number;
  passed: boolean;
  requiredPct: number;
  attemptNo: number;
  bestScorePct: number;
  results: Array<{ questionId: string; selectedIndex: number | null; correctIndex: number; correct: boolean }>;
}

interface SubmitRawResult {
  question_id: string;
  selected_index: number | null;
  correct_index: number;
  correct: boolean;
}

/** Mark one attempt server-side and update the enrollment's cached pass state. */
export async function submitQuizAnswers(
  db: Db,
  enrollmentId: string,
  answers: Array<{ questionId: string; selectedIndex: number | null }>
): Promise<QuizSubmitResult> {
  const { data, error } = await db.rpc('submit_training_quiz', {
    p_enrollment_id: enrollmentId,
    p_answers: answers,
  });
  if (error) {
    return {
      ok: false,
      code: 'RPC_ERROR',
      scorePct: 0,
      correctCount: 0,
      totalQuestions: 0,
      passed: false,
      requiredPct: 0,
      attemptNo: 0,
      bestScorePct: 0,
      results: [],
    };
  }
  const res = (data ?? {}) as Record<string, unknown>;
  const results = Array.isArray(res.results) ? (res.results as SubmitRawResult[]) : [];
  return {
    ok: res.ok === true,
    code: res.code ? String(res.code) : undefined,
    scorePct: Number(res.score_pct || 0),
    correctCount: Number(res.correct_count || 0),
    totalQuestions: Number(res.total_questions || 0),
    passed: res.passed === true,
    requiredPct: Number(res.required_pct || 0),
    attemptNo: Number(res.attempt_no || 0),
    bestScorePct: Number(res.best_score_pct || 0),
    results: results.map((r) => ({
      questionId: String(r.question_id),
      selectedIndex: r.selected_index === null || r.selected_index === undefined ? null : Number(r.selected_index),
      correctIndex: Number(r.correct_index),
      correct: r.correct === true,
    })),
  };
}

export interface QuizCourseSummary {
  required: boolean;
  passPct: number;
  questionCount: number;
  generationStatus: string;
  generationError: string | null;
  generatedAt: string | null;
  model: string | null;
}

/** Assessment configuration + question count for a course. */
export async function getQuizCourseSummary(db: Db, courseId: string): Promise<QuizCourseSummary> {
  const { data } = await db
    .from('training_courses')
    .select('quiz_pass_pct, quiz_generation_status, quiz_generation_error, quiz_generated_at, quiz_model')
    .eq('id', courseId)
    .maybeSingle();
  const { count } = await db
    .from('training_quiz_questions')
    .select('id', { count: 'exact', head: true })
    .eq('course_id', courseId);
  const course = (data as Record<string, unknown> | null) || {};
  const questionCount = Number(count || 0);
  return {
    required: questionCount > 0,
    passPct: Number(course.quiz_pass_pct ?? 70),
    questionCount,
    generationStatus: String(course.quiz_generation_status || 'NONE'),
    generationError: course.quiz_generation_error ? String(course.quiz_generation_error) : null,
    generatedAt: course.quiz_generated_at ? String(course.quiz_generated_at) : null,
    model: course.quiz_model ? String(course.quiz_model) : null,
  };
}
