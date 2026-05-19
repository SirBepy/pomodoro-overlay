// @ts-nocheck
const { invoke } = window.__TAURI__.core;

export type Phase = "work" | "short" | "long" | "other" | "snooze";
export type EndedBy = "natural" | "pause" | "skip" | "switch" | "app_close";

export interface StatsEvent {
  session_id: string;
  phase: Phase;
  start_ms: number;
  end_ms: number | null;
  configured_seconds: number | null;
  ended_by: EndedBy | null;
}

let currentSessionId: string | null = null;
let currentPhase: Phase | null = null;
let openEventStartMs: number | null = null;

function uuid(): string {
  return crypto.randomUUID();
}

function nowMs(): number {
  return Date.now();
}

/**
 * Open a new event. If the same phase is being resumed after a pause, pass
 * resumeSession=true so the new interval shares the existing session_id.
 */
export async function openEvent(
  phase: Phase,
  configuredSeconds: number | null,
  resumeSession = false,
): Promise<void> {
  if (!resumeSession || !currentSessionId || currentPhase !== phase) {
    currentSessionId = uuid();
  }
  currentPhase = phase;
  openEventStartMs = nowMs();
  const event: StatsEvent = {
    session_id: currentSessionId,
    phase,
    start_ms: openEventStartMs,
    end_ms: null,
    configured_seconds: configuredSeconds,
    ended_by: null,
  };
  try {
    await invoke("append_stats_event", { event });
  } catch (e) {
    console.warn("stats: append failed", e);
  }
}

/**
 * Close the currently open event. Pass the reason; if "switch" or "skip" or
 * "natural" the session is over and the next openEvent will mint a new
 * session_id. "pause" keeps the session_id so the next openEvent with
 * resumeSession=true continues it.
 */
export async function closeOpenEvent(endedBy: EndedBy): Promise<void> {
  if (openEventStartMs === null) return;
  openEventStartMs = null;
  if (endedBy !== "pause") {
    currentSessionId = null;
    currentPhase = null;
  }
  try {
    await invoke("close_open_stats_event", {
      endMs: nowMs(),
      endedBy,
    });
  } catch (e) {
    console.warn("stats: close failed", e);
  }
}

export async function getRange(
  startMs: number,
  endMs: number,
): Promise<StatsEvent[]> {
  try {
    return await invoke("get_stats_range", { startMs, endMs });
  } catch (e) {
    console.warn("stats: range failed", e);
    return [];
  }
}

export async function resetStats(): Promise<void> {
  await invoke("reset_stats");
  currentSessionId = null;
  currentPhase = null;
  openEventStartMs = null;
}
