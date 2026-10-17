'use client';

import { useCallback, useEffect, useState } from 'react';
import { Sparkles, Trash2, Loader2, CheckCircle2, AlertTriangle, ListChecks } from 'lucide-react';
import { getEmployeeSession } from '@/lib/supabase/session';
import { supabase } from '@/lib/supabase/client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';

interface AdminQuestion {
  id: string;
  prompt: string;
  options: string[];
  position: number;
  correctIndex: number;
  explanation: string | null;
}

interface QuizSummary {
  required: boolean;
  passPct: number;
  questionCount: number;
  generationStatus: string;
  generationError: string | null;
  generatedAt: string | null;
  model: string | null;
}

export interface AssessmentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  course: { id: string; title: string; hasVideo: boolean } | null;
  onChanged?: () => void;
}

function authHeaders(): Record<string, string> {
  const token = getEmployeeSession()?.access_token;
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

export function AssessmentDialog({ open, onOpenChange, course, onChanged }: AssessmentDialogProps) {
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [savingConfig, setSavingConfig] = useState(false);
  const [questions, setQuestions] = useState<AdminQuestion[]>([]);
  const [summary, setSummary] = useState<QuizSummary | null>(null);
  const [count, setCount] = useState('10');
  const [passPct, setPassPct] = useState('70');

  const load = useCallback(async () => {
    if (!course) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/training/quiz/${course.id}`, { headers: authHeaders() });
      if (!res.ok) throw new Error(res.status === 403 ? 'You do not have permission.' : 'Could not load the assessment.');
      const data = (await res.json()) as { questions: AdminQuestion[]; summary: QuizSummary };
      setQuestions(data.questions || []);
      setSummary(data.summary);
      setPassPct(String(data.summary?.passPct ?? 70));
      if (data.summary?.questionCount) setCount(String(data.summary.questionCount));
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [course]);

  useEffect(() => {
    if (open && course) void load();
    if (!open) {
      setQuestions([]);
      setSummary(null);
    }
  }, [open, course, load]);

  const saveConfig = async () => {
    if (!course) return;
    setSavingConfig(true);
    try {
      const { error } = await supabase
        .from('training_courses')
        .update({
          quiz_pass_pct: Math.max(0, Math.min(100, parseInt(passPct, 10) || 70)),
          quiz_question_count: Math.max(1, Math.min(30, parseInt(count, 10) || 10)),
        })
        .eq('id', course.id);
      if (error) throw error;
      toast.success('Assessment settings saved');
      onChanged?.();
    } catch (err) {
      toast.error('Failed: ' + (err as Error).message);
    } finally {
      setSavingConfig(false);
    }
  };

  const generate = async (regenerate: boolean) => {
    if (!course) return;
    if (regenerate && questions.length > 0 && !window.confirm('Regenerate the assessment? This replaces the current questions and resets everyone\u2019s pass status.')) {
      return;
    }
    setGenerating(true);
    try {
      const res = await fetch('/api/training/quiz/generate', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ courseId: course.id, count: parseInt(count, 10) || 10 }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string; questions?: AdminQuestion[]; summary?: QuizSummary };
      if (!res.ok || !data.ok) throw new Error(data.error || 'Question generation failed.');
      setQuestions(data.questions || []);
      setSummary(data.summary || null);
      setPassPct(String(data.summary?.passPct ?? passPct));
      toast.success(`${data.questions?.length || 0} questions generated from the video`);
      onChanged?.();
    } catch (err) {
      toast.error((err as Error).message);
      void load();
    } finally {
      setGenerating(false);
    }
  };

  const deleteQuestion = async (id: string) => {
    if (!course) return;
    const remaining = questions.filter((q) => q.id !== id);
    try {
      const res = await fetch(`/api/training/quiz/${course.id}`, {
        method: 'PUT',
        headers: authHeaders(),
        body: JSON.stringify({
          questions: remaining.map((q) => ({
            prompt: q.prompt,
            options: q.options,
            correctIndex: q.correctIndex,
            explanation: q.explanation || undefined,
          })),
        }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string; questions?: AdminQuestion[]; summary?: QuizSummary };
      if (!res.ok || !data.ok) throw new Error(data.error || 'Could not update the questions.');
      setQuestions(data.questions || []);
      setSummary(data.summary || null);
      toast.success('Question removed');
      onChanged?.();
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  const hasQuestions = questions.length > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ListChecks className="h-5 w-5" /> End-of-video assessment
          </DialogTitle>
          <DialogDescription>
            {course?.title} — questions are generated automatically from the lesson video. Employees must
            score at least the pass mark to receive a certificate.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label>Number of questions</Label>
              <Input type="number" min={1} max={30} value={count} onChange={(e) => setCount(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Pass mark (%)</Label>
              <Input type="number" min={0} max={100} value={passPct} onChange={(e) => setPassPct(e.target.value)} />
            </div>
            <div className="flex items-end">
              <Button variant="outline" className="w-full" onClick={() => void saveConfig()} disabled={savingConfig}>
                {savingConfig ? 'Saving…' : 'Save settings'}
              </Button>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={() => void generate(hasQuestions)} disabled={generating || !course?.hasVideo}>
              {generating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
              {hasQuestions ? 'Regenerate from video' : 'Generate from video'}
            </Button>
            {!course?.hasVideo && (
              <span className="text-xs text-muted-foreground">Upload a lesson video first.</span>
            )}
            {summary?.generationStatus === 'PENDING' && (
              <Badge variant="outline" className="bg-info/10 text-info">
                <Loader2 className="mr-1 h-3 w-3 animate-spin" /> Generating…
              </Badge>
            )}
            {summary?.generationStatus === 'READY' && (
              <Badge variant="outline" className="bg-success/10 text-success">
                <CheckCircle2 className="mr-1 h-3 w-3" /> {summary.questionCount} question{summary.questionCount === 1 ? '' : 's'}
                {summary.model ? ` · ${summary.model}` : ''}
              </Badge>
            )}
            {summary?.generationStatus === 'FAILED' && (
              <Badge variant="outline" className="bg-destructive/10 text-destructive">
                <AlertTriangle className="mr-1 h-3 w-3" /> Generation failed
              </Badge>
            )}
          </div>

          {summary?.generationError && summary.generationStatus === 'FAILED' && (
            <p className="rounded-md border border-destructive/30 bg-destructive/5 p-2 text-xs text-destructive">
              {summary.generationError}
            </p>
          )}

          <div className="max-h-80 space-y-3 overflow-y-auto rounded-md border border-border p-3">
            {loading ? (
              <div className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading…
              </div>
            ) : !hasQuestions ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                No assessment yet. Generate one from the lesson video above.
              </p>
            ) : (
              questions.map((q, i) => (
                <div key={q.id} className="rounded-md border border-border bg-muted/20 p-3">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm font-medium">
                      {i + 1}. {q.prompt}
                    </p>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 shrink-0 text-muted-foreground"
                      onClick={() => void deleteQuestion(q.id)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                  <ul className="mt-1.5 space-y-1">
                    {q.options.map((opt, j) => (
                      <li
                        key={j}
                        className={
                          j === q.correctIndex
                            ? 'flex items-center gap-1.5 text-xs font-medium text-success'
                            : 'flex items-center gap-1.5 text-xs text-muted-foreground'
                        }
                      >
                        {j === q.correctIndex ? <CheckCircle2 className="h-3 w-3" /> : <span className="w-3" />}
                        {opt}
                      </li>
                    ))}
                  </ul>
                  {q.explanation && <p className="mt-1.5 text-xs italic text-muted-foreground">{q.explanation}</p>}
                </div>
              ))
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default AssessmentDialog;
