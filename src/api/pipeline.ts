/**
 * Typed client for the local PCB pipeline API (server/app.py).
 *
 * Change BASE_URL when deploying somewhere other than the local dev server.
 */

import { CAUSES } from '../engine/knowledgeBase';
import type { CauseId, DefectId } from '../engine/types';
import type { CaseRecord } from '../db/caseDB';

export const BASE_URL = 'http://localhost:8000';

/** One detected + classified leg. */
export interface LegResult {
  leg_id: number;
  bbox: [number, number, number, number]; // x1, y1, x2, y2 in image pixels
  label: string; // "Less Paste" | "Bridging" | "Good"
  confidence: number; // 0-100
  flag: boolean; // non-Good OR low confidence
}

export interface DefectSummary {
  'Less Paste': number;
  Bridging: number;
  Good: number;
}

/** Full response from POST /analyze. */
export interface AnalysisResult {
  image_path: string;
  board_verdict: string; // "PASS" | "FAIL" | "ERROR - no legs found"
  defect_summary: DefectSummary;
  total_legs_detected: number;
  legs: LegResult[];
  flagged_legs: number;
  low_confidence_count: number;
  processing_time_ms?: number;
  model_version?: string;
}

/** One entry from GET /boards. */
export interface BoardInfo {
  filename: string;
  path: string;
  ground_truth: string | null;
}

export interface EngineerFeedback {
  actual_cause?: string | null;
  confirmed_defects?: string[] | null;
  notes?: string | null;
}

/** Body for POST /cases. */
export interface CaseLog {
  image_path: string;
  analysis_result: AnalysisResult;
  engineer_feedback: EngineerFeedback;
}

/** Response from GET /cases/similar. */
export interface SimilarCasesResult {
  defect_type: string;
  total_cases: number;
  confirmed_causes: Record<string, number>;
  most_common_cause: string | null;
  message: string;
}

/** One turn in the chat transcript. */
export interface ChatMessage {
  role: 'user' | 'model';
  content: string;
}

/** Rule-engine output passed to the chat endpoint as grounding. */
export interface RuleEngineResult {
  defect_name: string;
  defect_confidence: number;
  ranked_causes: { cause: string; score: number; reasons: string[] }[];
  action_plan: string[];
  reasoning: string;
}

export type ChatPhase = 'discovery' | 'diagnosis' | 'followup';

/** Response from POST /chat. */
export interface ChatResponse {
  reply: string;
  suggested_phase: string;
  questions_asked: number;
  ready_for_diagnosis: boolean;
}

async function parseError(res: Response): Promise<never> {
  let detail = `${res.status} ${res.statusText}`;
  try {
    const body = (await res.json()) as { detail?: string };
    if (body.detail) detail = body.detail;
  } catch {
    // non-JSON error body - keep the status text
  }
  throw new Error(`Pipeline API error: ${detail}`);
}

/** Analyze a board image that lives on the server (path under the repo). */
export async function analyzeBoard(imagePath: string): Promise<AnalysisResult> {
  const res = await fetch(`${BASE_URL}/analyze`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ image_path: imagePath }),
  });
  if (!res.ok) await parseError(res);
  return (await res.json()) as AnalysisResult;
}

/** Analyze a user-uploaded image file. */
export async function analyzeBoardUpload(file: File): Promise<AnalysisResult> {
  const form = new FormData();
  form.append('file', file);
  const res = await fetch(`${BASE_URL}/analyze`, {
    method: 'POST',
    body: form,
  });
  if (!res.ok) await parseError(res);
  return (await res.json()) as AnalysisResult;
}

/** List available board images + their ground-truth labels. */
export async function getBoards(): Promise<BoardInfo[]> {
  const res = await fetch(`${BASE_URL}/boards`);
  if (!res.ok) await parseError(res);
  const body = (await res.json()) as { boards: BoardInfo[] };
  return body.boards;
}

/** URL for a board thumbnail (used directly as an <img> src). */
export function getThumbnailUrl(filename: string): string {
  return `${BASE_URL}/boards/${encodeURIComponent(filename)}/thumbnail`;
}

/** Log a case to the learning database. */
export async function logCase(data: CaseLog): Promise<{ case_id: string }> {
  const res = await fetch(`${BASE_URL}/cases`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) await parseError(res);
  return (await res.json()) as { case_id: string };
}

/** Merge a partial edit into one stored case (learning database CRUD). */
export async function updateCase(caseId: string, patch: Record<string, unknown>): Promise<void> {
  const res = await fetch(`${BASE_URL}/cases/${encodeURIComponent(caseId)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  if (!res.ok) await parseError(res);
}

/** Delete a single stored case (learning database CRUD). */
export async function deleteCase(caseId: string): Promise<void> {
  const res = await fetch(`${BASE_URL}/cases/${encodeURIComponent(caseId)}`, { method: 'DELETE' });
  if (!res.ok) await parseError(res);
}

/** Ask the learning database for similar historical cases. */
export async function getSimilarCases(defectType: string): Promise<SimilarCasesResult> {
  const url = `${BASE_URL}/cases/similar?defect_type=${encodeURIComponent(defectType)}`;
  const res = await fetch(url);
  if (!res.ok) await parseError(res);
  return (await res.json()) as SimilarCasesResult;
}

/** Response from GET /cases/matching - the actual records behind /cases/similar. */
export interface MatchingCasesResult {
  defect_type: string;
  total: number;
  cases: Record<string, unknown>[];
}

/** The deduped case records that make up /cases/similar's counts. */
export async function getMatchingCases(defectType: string): Promise<MatchingCasesResult> {
  const url = `${BASE_URL}/cases/matching?defect_type=${encodeURIComponent(defectType)}`;
  const res = await fetch(url);
  if (!res.ok) await parseError(res);
  return (await res.json()) as MatchingCasesResult;
}

/** Send one conversational turn to the Gemini-backed diagnosis chat. */
export async function chat(
  message: string,
  conversationHistory: ChatMessage[],
  analysisResult: AnalysisResult | null,
  phase: ChatPhase,
  ruleEngineResult: RuleEngineResult | null,
  similarCases: SimilarCasesResult | null,
): Promise<ChatResponse> {
  const res = await fetch(`${BASE_URL}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message,
      conversation_history: conversationHistory,
      analysis_result: analysisResult,
      phase,
      rule_engine_result: ruleEngineResult,
      similar_cases: similarCases,
    }),
  });
  if (!res.ok) await parseError(res);
  return (await res.json()) as ChatResponse;
}

// ---------------------------------------------------------------------------
// Learning-database bridge: server cases -> IndexedDB-shaped prior inputs
// ---------------------------------------------------------------------------

/** Vision defect display name -> closest rule-engine DefectId. */
function mapDefectType(defectName?: string | null): DefectId | null {
  // verified: the engine's identifyDefect() returns these for the board classes
  // (Less Paste symptoms -> missing-dot, Bridging -> oversized-dot)
  if (defectName === 'Less Paste') return 'missing-dot';
  if (defectName === 'Bridging') return 'oversized-dot';
  return null;
}

/** Reverse lookup of the knowledge base's cause display names -> CauseId. */
const CAUSE_BY_NAME: Record<string, CauseId> = Object.fromEntries(
  Object.entries(CAUSES).map(([id, info]) => [info.name, id as CauseId]),
);

function causeNameToId(name?: string | null): CauseId | null {
  if (!name) return null;
  return CAUSE_BY_NAME[name] ?? null;
}

/**
 * Fetch all server case-log records and map them into CaseRecord shape so the
 * rule engine's priorOverrides() can blend confirmed causes from the server.
 * Returns [] when the server is unreachable (never throws).
 */
export async function fetchServerCasesAsIdbFormat(): Promise<CaseRecord[]> {
  try {
    const res = await fetch(`${BASE_URL}/cases/all`);
    if (!res.ok) return [];
    const body = (await res.json()) as { cases?: unknown[] };
    const out: CaseRecord[] = [];
    for (const raw of body.cases ?? []) {
      const rec = raw as {
        timestamp?: number;
        engineer_feedback?: {
          actual_cause?: string | null;
          confirmed_defects?: string[] | null;
        };
      };
      const fb = rec.engineer_feedback ?? {};
      const defectId = mapDefectType(fb.confirmed_defects?.[0]);
      const causeId = causeNameToId(fb.actual_cause);
      // only confirmed cases with a known cause and defect are usable as priors
      if (!defectId || !causeId) continue;
      out.push({
        timestamp: (rec.timestamp ?? 0) * 1000, // server uses seconds -> ms
        material: 'unknown',
        defectId,
        symptoms: [],
        topCause: causeId,
        resolvedCause: causeId,
      });
    }
    return out;
  } catch {
    return [];
  }
}
