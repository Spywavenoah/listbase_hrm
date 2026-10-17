import type { Db } from './server';
import { COMPANY_SETTINGS_GROUP, GEMINI_API_KEY_SETTING, VIDEO_BUCKET } from './constants';

export interface GeneratedQuestion {
  prompt: string;
  options: string[];
  correctIndex: number;
  explanation?: string;
}

export interface QuizGenerationInput {
  courseId: string;
  title: string;
  category?: string | null;
  count: number;
  videoPath?: string | null;
  videoUrl?: string | null;
  videoMimeType?: string | null;
}

export interface QuizGenerationResult {
  questions: GeneratedQuestion[];
  model: string;
  provider: string;
}

export class QuizProviderError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = 'QuizProviderError';
  }
}

const DEFAULT_GEMINI_MODEL = 'gemini-2.0-flash';
const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com';

/** Un-mask a setting value (the UI may store a placeholder for a saved secret). */
function parseSetting(raw: unknown): string {
  if (raw === null || raw === undefined) return '';
  const t = typeof raw === 'string' ? raw.trim() : '';
  if (!t) return '';
  if (t.startsWith('••••')) return '';
  try {
    const parsed = JSON.parse(t);
    return typeof parsed === 'string' ? parsed.trim() : t;
  } catch {
    return t.replace(/^"|"$/g, '').trim();
  }
}

/**
 * The Gemini key the assessment generator listens for: the Company setting
 * (Settings → Company → GEMINI_API_KEY) first, then the env fallback.
 */
export async function getGeminiApiKey(db: Db): Promise<string> {
  try {
    const { data } = await db
      .from('system_settings')
      .select('value')
      .eq('group_name', COMPANY_SETTINGS_GROUP)
      .eq('key', GEMINI_API_KEY_SETTING)
      .maybeSingle();
    const fromSettings = parseSetting(data?.value);
    if (fromSettings) return fromSettings;
  } catch {
    /* fall through */
  }
  return process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '';
}

/** True when a key is available (settings or env). */
export async function quizProviderConfigured(db: Db): Promise<boolean> {
  if (isMockMode()) return true;
  return Boolean(await getGeminiApiKey(db));
}

function isMockMode(): boolean {
  return (process.env.QUIZ_PROVIDER || '').toLowerCase() === 'mock';
}

function geminiModel(): string {
  return process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL;
}

function guessMimeType(pathOrUrl: string | null | undefined, fallback?: string | null): string {
  if (fallback) return fallback;
  const s = (pathOrUrl || '').toLowerCase();
  if (s.endsWith('.webm')) return 'video/webm';
  if (s.endsWith('.ogv') || s.endsWith('.ogg')) return 'video/ogg';
  if (s.endsWith('.mov')) return 'video/quicktime';
  return 'video/mp4';
}

/** Download the lesson bytes from storage, or fall back to fetching a public URL. */
async function loadVideoBytes(
  db: Db,
  input: QuizGenerationInput
): Promise<{ bytes: Uint8Array; mimeType: string; displayName: string }> {
  const mimeType = guessMimeType(input.videoPath || input.videoUrl, input.videoMimeType);
  if (input.videoPath) {
    const { data, error } = await db.storage.from(VIDEO_BUCKET).download(input.videoPath);
    if (error || !data) {
      throw new QuizProviderError('VIDEO_UNAVAILABLE', error?.message || 'Lesson video could not be read.');
    }
    const bytes = new Uint8Array(await data.arrayBuffer());
    return { bytes, mimeType, displayName: input.videoPath.split('/').pop() || 'lesson' };
  }
  if (input.videoUrl) {
    const res = await fetch(input.videoUrl);
    if (!res.ok) {
      throw new QuizProviderError('VIDEO_UNAVAILABLE', `Lesson video could not be fetched (${res.status}).`);
    }
    const bytes = new Uint8Array(await res.arrayBuffer());
    return { bytes, mimeType, displayName: 'lesson' };
  }
  throw new QuizProviderError('NO_VIDEO', 'This course has no lesson video to generate an assessment from.');
}

function buildPrompt(title: string, category: string | null | undefined, count: number): string {
  return [
    `You are building a short knowledge check for a workplace training video.`,
    `Course title: "${title}".`,
    category ? `Category: ${category}.` : '',
    `Watch the video and write exactly ${count} multiple-choice questions that test the key facts and takeaways actually taught in it.`,
    `Rules:`,
    `- Every question must be answerable from the video's content alone (spoken words or on-screen text).`,
    `- Provide exactly 4 answer options per question; only one is correct.`,
    `- Keep questions short and unambiguous; avoid trivia and trick questions.`,
    `- Vary the position of the correct option.`,
    `- Include a one-sentence explanation for each correct answer.`,
    `- Return ONLY JSON matching the provided schema.`,
  ]
    .filter(Boolean)
    .join('\n');
}

function sanitizeQuestions(raw: unknown, count: number): GeneratedQuestion[] {
  const list =
    raw && typeof raw === 'object' && Array.isArray((raw as { questions?: unknown[] }).questions)
      ? ((raw as { questions: unknown[] }).questions as unknown[])
      : [];
  const out: GeneratedQuestion[] = [];
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const q = item as Record<string, unknown>;
    const prompt = typeof q.prompt === 'string' ? q.prompt.trim() : '';
    const options = Array.isArray(q.options)
      ? q.options.map((o) => String(o ?? '').trim()).filter((o) => o.length > 0)
      : [];
    if (!prompt || options.length < 2) continue;
    let correctIndex = Number(q.correctIndex);
    if (!Number.isFinite(correctIndex)) correctIndex = 0;
    correctIndex = Math.max(0, Math.min(options.length - 1, Math.floor(correctIndex)));
    const explanation = typeof q.explanation === 'string' ? q.explanation.trim() : undefined;
    out.push({ prompt, options, correctIndex, explanation });
    if (out.length >= count) break;
  }
  return out;
}

async function geminiUploadVideo(
  key: string,
  video: { bytes: Uint8Array; mimeType: string; displayName: string }
): Promise<{ uri: string; name: string }> {
  const startRes = await fetch(`${GEMINI_API_BASE}/upload/v1beta/files?key=${key}`, {
    method: 'POST',
    headers: {
      'X-Goog-Upload-Protocol': 'resumable',
      'X-Goog-Upload-Command': 'start',
      'X-Goog-Upload-Header-Content-Length': String(video.bytes.byteLength),
      'X-Goog-Upload-Header-Content-Type': video.mimeType,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ file: { display_name: video.displayName } }),
  });
  if (!startRes.ok) {
    throw new QuizProviderError('PROVIDER_ERROR', `Video upload could not start (${startRes.status}).`);
  }
  const uploadUrl = startRes.headers.get('x-goog-upload-url');
  if (!uploadUrl) {
    throw new QuizProviderError('PROVIDER_ERROR', 'Video upload URL was not returned.');
  }

  const upRes = await fetch(uploadUrl, {
    method: 'POST',
    headers: {
      'Content-Length': String(video.bytes.byteLength),
      'X-Goog-Upload-Offset': '0',
      'X-Goog-Upload-Command': 'upload, finalize',
    },
    body: video.bytes,
  });
  if (!upRes.ok) {
    throw new QuizProviderError('PROVIDER_ERROR', `Video upload failed (${upRes.status}).`);
  }
  const upJson = (await upRes.json()) as { file?: { name?: string; uri?: string; state?: string } };
  const name = upJson.file?.name;
  if (!name) {
    throw new QuizProviderError('PROVIDER_ERROR', 'Video upload did not return a file reference.');
  }

  // wait for the file to finish processing
  let uri = upJson.file?.uri || '';
  let state = upJson.file?.state || 'PROCESSING';
  for (let i = 0; state === 'PROCESSING' && i < 30; i += 1) {
    await new Promise((r) => setTimeout(r, 2000));
    const pollRes = await fetch(`${GEMINI_API_BASE}/v1beta/${name}?key=${key}`);
    if (!pollRes.ok) break;
    const pollJson = (await pollRes.json()) as { uri?: string; state?: string };
    uri = pollJson.uri || uri;
    state = pollJson.state || state;
  }
  if (state === 'FAILED') {
    throw new QuizProviderError('PROVIDER_ERROR', 'The video could not be processed by the model.');
  }
  if (!uri) {
    throw new QuizProviderError('PROVIDER_ERROR', 'The video was not ready for analysis in time.');
  }
  return { uri, name };
}

async function generateWithGemini(input: QuizGenerationInput, db: Db): Promise<QuizGenerationResult> {
  const key = await getGeminiApiKey(db);
  if (!key) {
    throw new QuizProviderError('NOT_CONFIGURED', 'No Gemini API key is configured. Add one under Settings → Company → GEMINI_API_KEY.');
  }
  const video = await loadVideoBytes(db, input);
  const { uri } = await geminiUploadVideo(key, video);
  const model = geminiModel();

  const body = {
    contents: [
      {
        parts: [
          { file_data: { mime_type: video.mimeType, file_uri: uri } },
          { text: buildPrompt(input.title, input.category, input.count) },
        ],
      },
    ],
    generationConfig: {
      temperature: 0.4,
      responseMimeType: 'application/json',
      responseSchema: {
        type: 'OBJECT',
        properties: {
          questions: {
            type: 'ARRAY',
            items: {
              type: 'OBJECT',
              properties: {
                prompt: { type: 'STRING' },
                options: { type: 'ARRAY', items: { type: 'STRING' } },
                correctIndex: { type: 'INTEGER' },
                explanation: { type: 'STRING' },
              },
              required: ['prompt', 'options', 'correctIndex'],
            },
          },
        },
        required: ['questions'],
      },
    },
  };

  const res = await fetch(`${GEMINI_API_BASE}/v1beta/models/${model}:generateContent?key=${key}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new QuizProviderError('PROVIDER_ERROR', `The AI provider returned ${res.status}. ${detail.slice(0, 300)}`.trim());
  }
  const json = (await res.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const text = json.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || '';
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new QuizProviderError('PROVIDER_ERROR', 'The AI provider returned an unreadable response.');
  }
  const questions = sanitizeQuestions(parsed, input.count);
  if (questions.length === 0) {
    throw new QuizProviderError('PROVIDER_ERROR', 'The AI provider did not return any usable questions.');
  }
  return { questions, model, provider: 'gemini' };
}

function generateMock(input: QuizGenerationInput): QuizGenerationResult {
  const count = Math.max(1, Math.min(50, Math.floor(input.count) || 10));
  const questions: GeneratedQuestion[] = Array.from({ length: count }, (_, i) => {
    const correctIndex = i % 4;
    const options = ['Correct option', 'Wrong option A', 'Wrong option B', 'Wrong option C'];
    const rotated = [...options.slice(1, correctIndex + 1), options[0], ...options.slice(correctIndex + 1)];
    return {
      prompt: `Mock question ${i + 1} about "${input.title}"`,
      options: rotated,
      correctIndex,
      explanation: 'Mock question generated for testing.',
    };
  });
  return { questions, model: 'mock', provider: 'mock' };
}

/**
 * Generate a multiple-choice assessment from a course's lesson video.
 * Uses Gemini multimodal video understanding by default; a deterministic mock
 * provider (QUIZ_PROVIDER=mock) is available for tests and local development.
 */
export async function generateQuizFromVideo(
  db: Db,
  input: QuizGenerationInput
): Promise<QuizGenerationResult> {
  if (isMockMode()) return generateMock(input);
  return generateWithGemini(input, db);
}
