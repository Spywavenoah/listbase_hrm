export const HEARTBEAT_INTERVAL_MS = 7000;
export const MAX_GAP_MS = 15000;
export const MAX_PLAYBACK_RATE = 1.25;
export const SEGMENT_ADJACENCY_SEC = 0.75;
export const REACHED_END_TOLERANCE_SEC = 2;
export const DEFAULT_PASS_PCT = 95;
export const EXPECTED_HEARTBEAT_RATIO = 0.9;
export const DEFAULT_HEARTBEAT_INTERVAL_SEC = HEARTBEAT_INTERVAL_MS / 1000;

export const CERT_BUCKET = 'certification-documents';
export const TRAINING_SETTINGS_GROUP = 'training';
export const COMPLETION_ENFORCEMENT_KEY = 'completion_enforcement';
export const PROGRESS_TOKEN_PURPOSE = 'training.progress';
export const PROGRESS_TOKEN_TTL_SEC = 12 * 60 * 60;

export type EnforcementMode = 'SHADOW' | 'ENFORCED';

export type CompletionState = 'IN_PROGRESS' | 'ELIGIBLE' | 'BLOCKED' | 'ISSUED';
