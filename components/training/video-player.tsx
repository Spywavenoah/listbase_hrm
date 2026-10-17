'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Play, ShieldCheck, ShieldAlert, Award, RefreshCw, Loader2, Timer, ClipboardCheck, CheckCircle2 } from 'lucide-react';
import { getEmployeeSession } from '@/lib/supabase/session';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { QuizRunner } from '@/components/training/quiz-runner';
import type { CompletionEvaluation, QuizQuestionPublic, WatchSegment } from '@/lib/training/types';

const MAX_RATE = 1.25;
const SEGMENT_EPS = 0.05;

interface StatusResponse {
  enrollmentId: string;
  courseTitle: string;
  instructor: string | null;
  status: string;
  completionState: string;
  cycle: number;
  progressPct: number;
  resumePosition: number;
  durationSeconds: number;
  videoUrl: string | null;
  passPct: number;
  renewalMonths: number | null;
  enforcement: 'SHADOW' | 'ENFORCED';
  enforced: boolean;
  hasVideo: boolean;
  evaluation: CompletionEvaluation;
  eligible: boolean;
  reasons: string[];
  certificate: {
    certificateId: string | null;
    issuedAt: string | null;
    expiresAt: string | null;
    pdfUrl: string | null;
    cycle: number;
  };
  renewalDaysLeft: number | null;
  progressToken: string;
  sessionId: string;
  heartbeatIntervalMs: number;
  quiz: {
    required: boolean;
    passPct: number;
    questionCount: number;
    bestScorePct: number | null;
    passed: boolean;
    attempts: number;
    generationStatus: string;
    generationError: string | null;
    questions: QuizQuestionPublic[];
  };
}

interface CompleteResponse {
  ok: boolean;
  code?: string;
  message?: string;
  enforced?: boolean;
  shadow?: boolean;
  reasons?: string[];
  certificate?: {
    certificateId: string | null;
    issuedAt: string | null;
    expiresAt: string | null;
    pdfUrl: string | null;
    cycle: number;
  };
  renewalDaysLeft?: number | null;
  nextEnrollmentId?: string | null;
}

function authHeaders(): Record<string, string> {
  const token = getEmployeeSession()?.access_token;
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

/** Cheap, privacy-friendly device signal (hash of coarse, stable attributes). */
function deviceFingerprint(): string {
  if (typeof navigator === 'undefined') return 'unknown';
  const parts = [
    navigator.userAgent || '',
    navigator.language || '',
    typeof screen !== 'undefined' ? `${screen.width}x${screen.height}x${screen.colorDepth}` : '',
    String(new Date().getTimezoneOffset()),
    String((navigator as unknown as { hardwareConcurrency?: number }).hardwareConcurrency ?? ''),
    String((navigator as unknown as { maxTouchPoints?: number }).maxTouchPoints ?? ''),
  ].join('|');
  let h = 5381;
  for (let i = 0; i < parts.length; i++) h = ((h << 5) + h + parts.charCodeAt(i)) >>> 0;
  return `${h.toString(36)}${parts.length.toString(36)}`;
}

export interface VideoPlayerProps {
  enrollmentId: string;
  onCompleted?: () => void;
}

export function VideoPlayer({ enrollmentId, onCompleted }: VideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [progressPct, setProgressPct] = useState(0);
  const [state, setState] = useState('IN_PROGRESS');
  const [eligible, setEligible] = useState(false);
  const [reasons, setReasons] = useState<string[]>([]);
  const [cert, setCert] = useState<StatusResponse['certificate'] | null>(null);
  const [daysLeft, setDaysLeft] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [quizOpen, setQuizOpen] = useState(false);

  const statusRef = useRef<StatusResponse | null>(null);
  const tokenRef = useRef('');
  const sessionIdRef = useRef('');
  const intervalRef = useRef(7000);
  const closedRef = useRef<WatchSegment[]>([]);
  const openRef = useRef<{ start: number; end: number } | null>(null);
  const lastBeatRef = useRef(0);
  const interruptedRef = useRef(false);
  const dirtyRef = useRef(false);
  const maxRateRef = useRef(1);
  const hiddenRef = useRef(false);
  const resumeAppliedRef = useRef(false);
  const fingerprintRef = useRef('');

  const fingerprint = useCallback(() => {
    if (!fingerprintRef.current) fingerprintRef.current = deviceFingerprint();
    return fingerprintRef.current;
  }, []);

  const closeSegment = useCallback(() => {
    const open = openRef.current;
    if (open && open.end - open.start > SEGMENT_EPS) {
      closedRef.current.push({ start: open.start, end: open.end });
      if (closedRef.current.length > 400) closedRef.current = closedRef.current.slice(-400);
    }
    openRef.current = null;
  }, []);

  const markInterrupted = useCallback(() => {
    interruptedRef.current = true;
    dirtyRef.current = true;
  }, []);

  const openSegment = useCallback((position: number) => {
    if (!openRef.current) openRef.current = { start: position, end: position };
    dirtyRef.current = true;
  }, []);

  // ---------------------------------------------------------------- status
  const loadStatus = useCallback(async () => {
    try {
      const res = await fetch(`/api/training/enrollment/${enrollmentId}/status`, {
        headers: authHeaders(),
      });
      if (!res.ok) {
        setLoadError(
          res.status === 401 ? 'Please sign in again.' : 'Could not load training status.'
        );
        return;
      }
      const data = (await res.json()) as StatusResponse;
      setStatus(data);
      statusRef.current = data;
      setProgressPct(data.progressPct);
      setCert(data.certificate);
      setDaysLeft(data.renewalDaysLeft);
      setEligible(data.eligible);
      setReasons(data.reasons || []);
      setState(data.completionState);
      tokenRef.current = data.progressToken;
      sessionIdRef.current = data.sessionId;
      intervalRef.current = data.heartbeatIntervalMs || 7000;
      setLoadError(null);
    } catch {
      setLoadError('Network error while loading training status.');
    }
  }, [enrollmentId]);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  // resume as soon as both the metadata and the stored position are available
  const applyResume = useCallback(() => {
    const video = videoRef.current;
    const s = statusRef.current;
    if (!video || !s || resumeAppliedRef.current) return;
    if (!Number.isFinite(video.duration) || video.duration <= 0) return;
    const resume = Number(s.resumePosition || 0);
    if (resume > 1 && resume < video.duration - 1) video.currentTime = resume;
    resumeAppliedRef.current = true;
  }, []);

  // ------------------------------------------------------------- heartbeat
  const sendHeartbeat = useCallback(async () => {
    const video = videoRef.current;
    if (!video || !tokenRef.current) return;

    const now = Date.now();
    const playing = !video.paused && !video.ended && !hiddenRef.current;
    if (!playing && !dirtyRef.current) return;

    const position = video.currentTime;
    if (openRef.current) openRef.current.end = position;
    else if (playing) openSegment(position);

    const segments: WatchSegment[] = [...closedRef.current];
    if (openRef.current) segments.push(openRef.current);

    const since =
      interruptedRef.current || lastBeatRef.current === 0 ? 0 : now - lastBeatRef.current;

    const payload = {
      enrollmentId,
      token: tokenRef.current,
      sessionId: sessionIdRef.current,
      fingerprint: fingerprint(),
      position,
      duration: Number.isFinite(video.duration) ? video.duration : 0,
      playing,
      playbackRate: Math.max(maxRateRef.current, video.playbackRate || 1),
      segments,
      interrupted: interruptedRef.current,
      sinceLastMs: Math.round(since),
      clientTs: new Date(now).toISOString(),
    };

    lastBeatRef.current = now;
    interruptedRef.current = false;
    dirtyRef.current = false;

    try {
      const res = await fetch('/api/training/progress', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify(payload),
      });
      if (res.status === 403) {
        await loadStatus(); // refresh the per-enrollment token
        return;
      }
      if (!res.ok) return;
      const data = (await res.json()) as {
        progressPct?: number;
        state?: string;
        eligible?: boolean;
        reasons?: string[];
      };
      if (typeof data.progressPct === 'number') setProgressPct(data.progressPct);
      if (data.state) setState(data.state);
      if (typeof data.eligible === 'boolean') setEligible(data.eligible);
      if (Array.isArray(data.reasons)) setReasons(data.reasons);
    } catch {
      // transient network failure — the next beat retries
      dirtyRef.current = true;
    }
  }, [enrollmentId, fingerprint, loadStatus, openSegment]);

  // ----------------------------------------------------------- completion
  const submitCompletion = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    setNote(null);
    try {
      void sendHeartbeat(); // final flush
      const res = await fetch('/api/training/complete', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ enrollmentId, token: tokenRef.current }),
      });
      const data = (await res.json()) as CompleteResponse;
      if (!res.ok || !data.ok) {
        if (data.code === 'QUIZ_NOT_PASSED') {
          setNote(data.message || 'Pass the assessment to receive your certificate.');
          await loadStatus();
          setQuizOpen(true);
          return;
        }
        const why = (data.reasons || []).join(', ');
        setNote(
          data.message
            ? why
              ? `${data.message} (${why})`
              : data.message
            : 'Completion criteria are not met yet.'
        );
        setReasons(data.reasons || []);
        return;
      }
      setCert(data.certificate || null);
      setDaysLeft(data.renewalDaysLeft ?? null);
      setState('ISSUED');
      setNote('Certificate issued.');
      onCompleted?.();
    } catch {
      setNote('Could not submit completion. Please try again.');
    } finally {
      setBusy(false);
    }
  }, [busy, enrollmentId, loadStatus, onCompleted, sendHeartbeat]);

  // ------------------------------------------------------ assessment (quiz)
  const handleQuizPassed = useCallback(async () => {
    setQuizOpen(false);
    await loadStatus();
    void submitCompletion();
  }, [loadStatus, submitCompletion]);

  // ------------------------------------------------------- video lifecycle
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const onPlay = () => {
      applyResume();
      if (!hiddenRef.current) openSegment(video.currentTime);
    };
    const onPause = () => {
      closeSegment();
      markInterrupted();
    };
    const onSeeking = () => {
      closeSegment();
      markInterrupted();
    };
    const onSeeked = () => {
      markInterrupted();
      if (!video.paused && !hiddenRef.current) openSegment(video.currentTime);
    };
    const onWaiting = () => markInterrupted();
    const onEnded = () => {
      closeSegment();
      markInterrupted();
      const s = statusRef.current;
      if (s?.quiz?.required && !s.quiz.passed && (s.quiz.questions?.length || 0) > 0) {
        setQuizOpen(true);
        return;
      }
      void submitCompletion();
    };
    const onRateChange = () => {
      const rate = video.playbackRate || 1;
      if (rate > maxRateRef.current) maxRateRef.current = rate;
      if (rate > MAX_RATE) video.playbackRate = MAX_RATE;
    };
    const onLoadedMetadata = () => {
      applyResume();
      if (!video.paused && !hiddenRef.current) openSegment(video.currentTime);
    };
    const onVisibility = () => {
      const hidden = document.visibilityState === 'hidden';
      hiddenRef.current = hidden;
      if (hidden) {
        closeSegment();
        markInterrupted();
      } else {
        markInterrupted();
        if (!video.paused) openSegment(video.currentTime);
      }
    };
    const onError = () => setLoadError('This video could not be loaded.');

    video.addEventListener('play', onPlay);
    video.addEventListener('pause', onPause);
    video.addEventListener('seeking', onSeeking);
    video.addEventListener('seeked', onSeeked);
    video.addEventListener('waiting', onWaiting);
    video.addEventListener('ended', onEnded);
    video.addEventListener('ratechange', onRateChange);
    video.addEventListener('loadedmetadata', onLoadedMetadata);
    video.addEventListener('error', onError);
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      video.removeEventListener('play', onPlay);
      video.removeEventListener('pause', onPause);
      video.removeEventListener('seeking', onSeeking);
      video.removeEventListener('seeked', onSeeked);
      video.removeEventListener('waiting', onWaiting);
      video.removeEventListener('ended', onEnded);
      video.removeEventListener('ratechange', onRateChange);
      video.removeEventListener('loadedmetadata', onLoadedMetadata);
      video.removeEventListener('error', onError);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [applyResume, closeSegment, markInterrupted, openSegment, submitCompletion]);

  // heartbeat loop
  useEffect(() => {
    if (!status) return;
    const id = setInterval(() => void sendHeartbeat(), intervalRef.current);
    const flush = () => void sendHeartbeat();
    window.addEventListener('pagehide', flush);
    return () => {
      clearInterval(id);
      window.removeEventListener('pagehide', flush);
      void sendHeartbeat();
    };
  }, [status, sendHeartbeat]);

  // -------------------------------------------------------------- rendering
  if (loadError) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-border p-8 text-center">
        <ShieldAlert className="h-8 w-8 text-destructive" />
        <p className="text-sm text-muted-foreground">{loadError}</p>
        <Button variant="outline" size="sm" onClick={() => void loadStatus()}>
          Retry
        </Button>
      </div>
    );
  }

  if (!status) {
    return (
      <div className="flex items-center justify-center gap-2 rounded-lg border border-border p-8">
        <Loader2 className="h-4 w-4 animate-spin" />
        <span className="text-sm text-muted-foreground">Loading training…</span>
      </div>
    );
  }

  const issued = Boolean(cert?.certificateId);
  const coverage = Math.min(100, Math.round(progressPct));
  const quizLocked = status.quiz.required && !status.quiz.passed;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-medium">{status.courseTitle}</p>
          <p className="text-xs text-muted-foreground">
            {status.instructor ? `Instructor: ${status.instructor}` : 'Self-paced'}
            {status.cycle > 1 ? ` · Renewal cycle ${status.cycle}` : ''}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge
            variant="outline"
            className={status.enforced ? 'bg-warning/10 text-warning' : 'bg-muted text-muted-foreground'}
          >
            {status.enforced ? 'Strict completion' : 'Progress tracked'}
          </Badge>
          {issued && (
            <Badge variant="outline" className="bg-success/10 text-success">
              <Award className="mr-1 h-3 w-3" /> Certified
            </Badge>
          )}
        </div>
      </div>

      {status.hasVideo && status.videoUrl ? (
        <video
          ref={videoRef}
          src={status.videoUrl}
          controls
          playsInline
          preload="metadata"
          crossOrigin="anonymous"
          className="aspect-video w-full rounded-lg border border-border bg-black"
        />
      ) : (
        <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border p-10 text-center">
          <Play className="h-8 w-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            {status.hasVideo
              ? 'Video unavailable.'
              : 'No video lesson configured for this course.'}
          </p>
        </div>
      )}

      <div className="space-y-1">
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>Watched {coverage}%</span>
          <span>Required {status.passPct}%</span>
        </div>
        <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-primary transition-all"
            style={{ width: `${coverage}%` }}
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-1.5 text-xs">
          {eligible ? (
            <ShieldCheck className="h-4 w-4 text-success" />
          ) : (
            <ShieldAlert className="h-4 w-4 text-warning" />
          )}
          <span className="text-muted-foreground">
            {eligible ? 'Eligible for certificate' : 'Completing verification…'}
          </span>
        </div>
        {daysLeft !== null && issued && (
          <div className="flex items-center gap-1.5 text-xs">
            <Timer className="h-4 w-4 text-info" />
            <span className="text-muted-foreground">
              {daysLeft > 0
                ? `Renews in ${daysLeft} day${daysLeft === 1 ? '' : 's'}`
                : 'Renewal due'}
            </span>
          </div>
        )}
      </div>

      {!eligible && reasons.length > 0 && (
        <div className="rounded-md border border-warning/30 bg-warning/5 p-3">
          <p className="text-xs font-medium text-warning">Still to complete:</p>
          <ul className="mt-1 list-inside list-disc text-xs text-muted-foreground">
            {reasons.map((r) => (
              <li key={r}>{describeReason(r, status.passPct)}</li>
            ))}
          </ul>
        </div>
      )}

      {note && <p className="text-xs text-muted-foreground">{note}</p>}

      {status.quiz.required && (
        <div
          className={
            status.quiz.passed
              ? 'flex flex-wrap items-center gap-2 rounded-md border border-success/30 bg-success/5 p-3 text-xs'
              : 'flex flex-wrap items-center gap-2 rounded-md border border-info/30 bg-info/5 p-3 text-xs'
          }
        >
          {status.quiz.passed ? (
            <CheckCircle2 className="h-4 w-4 text-success" />
          ) : (
            <ClipboardCheck className="h-4 w-4 text-info" />
          )}
          <span className="text-muted-foreground">
            {status.quiz.passed
              ? `Assessment passed${status.quiz.bestScorePct !== null ? ` · ${status.quiz.bestScorePct}%` : ''}`
              : `Assessment required — score ${status.quiz.passPct}% or more to be certified`}
          </span>
          {!status.quiz.passed && status.quiz.questions.length > 0 && (
            <Button size="sm" variant="outline" className="ml-auto h-7" onClick={() => setQuizOpen(true)}>
              Take assessment
            </Button>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {!quizLocked && (
          <Button size="sm" onClick={() => void submitCompletion()} disabled={busy || issued}>
            {busy ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Award className="mr-2 h-4 w-4" />
            )}
            {issued ? 'Completed' : 'Complete & issue certificate'}
          </Button>
        )}
        {issued && cert?.pdfUrl && (
          <Button size="sm" variant="outline" asChild>
            <a href={cert.pdfUrl} target="_blank" rel="noopener noreferrer">
              View certificate
            </a>
          </Button>
        )}
        <Button size="sm" variant="ghost" onClick={() => void loadStatus()}>
          <RefreshCw className="mr-2 h-4 w-4" /> Refresh
        </Button>
        {state === 'ISSUED' && issued && cert?.expiresAt && (
          <span className="text-xs text-muted-foreground">
            Valid until {new Date(cert.expiresAt).toLocaleDateString()}
          </span>
        )}
      </div>

      <Dialog open={quizOpen} onOpenChange={(o) => { if (!o) setQuizOpen(false); }}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Assessment</DialogTitle>
            <DialogDescription>
              {status.quiz.questionCount} question{status.quiz.questionCount === 1 ? '' : 's'} · pass mark{' '}
              {status.quiz.passPct}%
            </DialogDescription>
          </DialogHeader>
          <div className="py-2">
            <QuizRunner
              enrollmentId={enrollmentId}
              token={tokenRef.current}
              questions={status.quiz.questions}
              passPct={status.quiz.passPct}
              onPassed={() => void handleQuizPassed()}
              onClose={() => setQuizOpen(false)}
            />
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function describeReason(reason: string, passPct: number): string {
  switch (reason) {
    case 'coverage_pct':
    case 'active_watch':
      return `Watch at least ${passPct}% of the video (each section must be played)`;
    case 'reached_end':
      return 'Play the video to the very end';
    case 'heartbeat_count':
      return 'Keep playback steady — too few progress signals were received';
    case 'max_gap_ms':
      return 'Avoid long interruptions while the lesson is open';
    case 'playback_rate':
      return 'Playback faster than 1.25× was detected';
    case 'fingerprint_mismatch':
      return 'This lesson was resumed from a different device/session';
    case 'quiz_passed':
      return 'Pass the end-of-video assessment to receive your certificate';
    default:
      return reason;
  }
}

export default VideoPlayer;
