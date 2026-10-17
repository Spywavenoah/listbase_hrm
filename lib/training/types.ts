import type { CompletionState, EnforcementMode } from './constants';

export interface WatchSegment {
  start: number;
  end: number;
}

export interface CompletionCheck {
  ok: boolean;
  actual?: number;
  required?: number;
  [k: string]: unknown;
}

export interface CompletionEvaluation {
  ok?: boolean;
  has_video?: boolean;
  duration_seconds?: number;
  coverage_seconds?: number;
  active_watch_seconds?: number;
  max_position_seconds?: number;
  heartbeat_count?: number;
  expected_heartbeats?: number;
  max_gap_ms?: number;
  max_playback_rate?: number;
  fingerprint_mismatch?: boolean;
  pass_pct?: number;
  checks?: Record<string, CompletionCheck>;
  reasons?: string[];
  eligible?: boolean;
  code?: string;
  error?: string;
}

export interface TrainingProgress {
  enrollment_id: string;
  watched_segments: WatchSegment[];
  last_position_seconds: number;
  last_heartbeat_at: string | null;
  watch_duration_seconds: number;
  duration_seconds: number | null;
  heartbeat_count: number;
  expected_heartbeats: number;
  max_position_seconds: number;
  max_playback_rate: number;
  max_gap_ms: number;
  session_id: string | null;
  device_fingerprint: string | null;
  fingerprint_mismatch: boolean;
  completion_state: CompletionState;
  decision: CompletionEvaluation | null;
}

export interface HeartbeatPayload {
  enrollmentId: string;
  token: string;
  sessionId: string;
  fingerprint: string;
  position: number;
  duration: number;
  playing: boolean;
  playbackRate: number;
  segments: WatchSegment[];
  interrupted: boolean;
  sinceLastMs: number;
  clientTs?: string;
}

export interface CertificateInfo {
  certificateId: string | null;
  issuedAt: string | null;
  expiresAt: string | null;
  pdfUrl: string | null;
  cycle: number;
}

export interface QuizQuestionPublic {
  id: string;
  prompt: string;
  options: string[];
  position: number;
}

export interface QuizAdminQuestion extends QuizQuestionPublic {
  correctIndex: number;
  explanation: string | null;
}

export interface QuizSummary {
  required: boolean;
  passPct: number;
  questionCount: number;
  bestScorePct: number | null;
  passed: boolean;
  attempts: number;
  generationStatus: string;
  generationError: string | null;
}

export interface QuizAttemptFeedback {
  questionId: string;
  selectedIndex: number | null;
  correctIndex: number;
  correct: boolean;
}

export interface EnrollmentStatus {
  enrollmentId: string;
  courseId: string;
  employeeId: string;
  courseTitle: string;
  status: string;
  completionState: CompletionState;
  cycle: number;
  progressPct: number;
  resumePosition: number;
  durationSeconds: number;
  videoUrl: string | null;
  passPct: number;
  renewalMonths: number | null;
  enforcement: EnforcementMode;
  enforced: boolean;
  validationEnabled: boolean;
  evaluation: CompletionEvaluation;
  eligible: boolean;
  reasons: string[];
  certificate: CertificateInfo;
  renewalDaysLeft: number | null;
  progressToken: string;
  sessionId: string;
  heartbeatIntervalMs: number;
  quiz: QuizSummary & { questions: QuizQuestionPublic[] };
}
