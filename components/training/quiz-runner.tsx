'use client';

import { useState } from 'react';
import { CheckCircle2, XCircle, Loader2, ClipboardCheck, Award, RefreshCw } from 'lucide-react';
import { getEmployeeSession } from '@/lib/supabase/session';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { QuizQuestionPublic } from '@/lib/training/types';

interface SubmitResponse {
  ok?: boolean;
  scorePct?: number;
  correctCount?: number;
  totalQuestions?: number;
  passed?: boolean;
  requiredPct?: number;
  attemptNo?: number;
  bestScorePct?: number;
  results?: Array<{ questionId: string; selectedIndex: number | null; correctIndex: number; correct: boolean }>;
  error?: string;
}

export interface QuizRunnerProps {
  enrollmentId: string;
  token: string;
  questions: QuizQuestionPublic[];
  passPct: number;
  onPassed: () => void;
  onClose?: () => void;
}

function authHeaders(): Record<string, string> {
  const token = getEmployeeSession()?.access_token;
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

export function QuizRunner({ enrollmentId, token, questions, passPct, onPassed, onClose }: QuizRunnerProps) {
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<SubmitResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const allAnswered = questions.length > 0 && questions.every((q) => answers[q.id] !== undefined);

  const submit = async () => {
    if (submitting || !allAnswered) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/training/quiz', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          enrollmentId,
          token,
          answers: questions.map((q) => ({ questionId: q.id, selectedIndex: answers[q.id] })),
        }),
      });
      const data = (await res.json()) as SubmitResponse;
      if (!res.ok || !data.ok) throw new Error(data.error || 'Could not submit your answers.');
      setResult(data);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  const retry = () => {
    setAnswers({});
    setResult(null);
    setError(null);
  };

  const correctIds = new Set((result?.results || []).filter((r) => r.correct).map((r) => r.questionId));
  const resultByQuestion = new Map((result?.results || []).map((r) => [r.questionId, r]));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <ClipboardCheck className="h-4 w-4 text-primary" />
          <p className="text-sm font-medium">Knowledge check</p>
        </div>
        <Badge variant="outline" className="bg-muted text-muted-foreground">
          Pass mark {result?.requiredPct ?? passPct}%
        </Badge>
      </div>

      {!result && (
        <p className="text-xs text-muted-foreground">
          Answer all {questions.length} question{questions.length === 1 ? '' : 's'} about the video. You need{' '}
          {passPct}% to receive your certificate — you can retake it as many times as you like.
        </p>
      )}

      {result && (
        <div
          className={cn(
            'rounded-md border p-3',
            result.passed ? 'border-success/30 bg-success/5' : 'border-warning/30 bg-warning/5'
          )}
        >
          <div className="flex items-center gap-2">
            {result.passed ? (
              <CheckCircle2 className="h-5 w-5 text-success" />
            ) : (
              <XCircle className="h-5 w-5 text-warning" />
            )}
            <p className="text-sm font-medium">
              {result.passed ? 'Passed' : 'Not passed'} — {result.scorePct}% ({result.correctCount}/
              {result.totalQuestions})
            </p>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {result.passed
              ? 'Great work. Your certificate is ready.'
              : `You need ${result.requiredPct}% to pass. Review the video and try again.`}
            {typeof result.attemptNo === 'number' ? ` · Attempt ${result.attemptNo}` : ''}
          </p>
        </div>
      )}

      <div className="max-h-[26rem] space-y-4 overflow-y-auto pr-1">
        {questions.map((q, i) => (
          <div key={q.id} className="space-y-2">
            <p className="text-sm font-medium">
              {i + 1}. {q.prompt}
            </p>
            <div className="space-y-1.5">
              {q.options.map((opt, j) => {
                const chosen = answers[q.id] === j;
                const row = resultByQuestion.get(q.id);
                const isCorrect = result ? row?.correctIndex === j : false;
                const isWrongChoice = result ? chosen && !correctIds.has(q.id) : false;
                return (
                  <button
                    key={j}
                    type="button"
                    disabled={Boolean(result)}
                    onClick={() => setAnswers((a) => ({ ...a, [q.id]: j }))}
                    className={cn(
                      'flex w-full items-center gap-2 rounded-md border px-3 py-2 text-left text-sm transition-colors',
                      result
                        ? isCorrect
                          ? 'border-success/40 bg-success/5'
                          : isWrongChoice
                            ? 'border-destructive/40 bg-destructive/5'
                            : 'border-border'
                        : chosen
                          ? 'border-primary bg-primary/5'
                          : 'border-border hover:bg-accent/50'
                    )}
                  >
                    <span
                      className={cn(
                        'flex h-4 w-4 shrink-0 items-center justify-center rounded-full border',
                        result
                          ? isCorrect
                            ? 'border-success text-success'
                            : isWrongChoice
                              ? 'border-destructive text-destructive'
                              : 'border-muted-foreground'
                          : chosen
                            ? 'border-primary'
                            : 'border-muted-foreground'
                      )}
                    >
                      {chosen ? <span className="h-2 w-2 rounded-full bg-current" /> : null}
                    </span>
                    <span className="flex-1">{opt}</span>
                    {result && isCorrect ? <CheckCircle2 className="h-4 w-4 text-success" /> : null}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {error && <p className="text-xs text-destructive">{error}</p>}

      <div className="flex flex-wrap items-center gap-2">
        {!result ? (
          <Button size="sm" onClick={() => void submit()} disabled={!allAnswered || submitting}>
            {submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ClipboardCheck className="mr-2 h-4 w-4" />}
            Submit answers
          </Button>
        ) : result.passed ? (
          <Button size="sm" onClick={onPassed}>
            <Award className="mr-2 h-4 w-4" /> Finish & get certificate
          </Button>
        ) : (
          <Button size="sm" onClick={retry}>
            <RefreshCw className="mr-2 h-4 w-4" /> Try again
          </Button>
        )}
        {onClose && (
          <Button size="sm" variant="ghost" onClick={onClose}>
            {result?.passed ? 'Close' : 'Later'}
          </Button>
        )}
      </div>
    </div>
  );
}

export default QuizRunner;
