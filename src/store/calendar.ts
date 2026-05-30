/**
 * Read-only calendar feeds for the Agenda (timeline) zone.
 *
 * Dependency-light: raw `fetch` + direct OAuth token refresh, no SDKs. Reuses
 * the credential files the old r3tools integration produced
 * (`google_token.json`, `azure_config.json`, `ms_token_cache.json`), so
 * existing tokens work without re-auth.
 *
 * Every fetch fails silently (returns []): a missing/expired/unconfigured
 * calendar must never break the board.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { createSignal } from "solid-js";

import type { CalendarsConfig, GoogleCalendarConfig } from "~/config/loader";

/** A calendar event mapped onto the target day's minute grid. */
export interface CalEvent {
  title: string;
  /** Minutes since local midnight of the target day (may be <0 if it started earlier). */
  startMin: number;
  endMin: number;
  color: string;
  source: "google" | "microsoft";
}

const GOOGLE_FALLBACK_COLOR = "#e8a05c";
const CACHE_DIR = join(homedir(), ".config", "tuiboard", "cal_cache");
const CACHE_TTL_MS = 30 * 60 * 1000;

// ─── Cache ────────────────────────────────────────────────────────────────────

function cachePath(source: string, dateIso: string): string {
  return join(CACHE_DIR, `${source}_${dateIso}.json`);
}

function loadCache(source: string, dateIso: string): CalEvent[] | undefined {
  try {
    const p = cachePath(source, dateIso);
    if (!existsSync(p)) return undefined;
    if (Date.now() - statSync(p).mtimeMs > CACHE_TTL_MS) return undefined;
    return JSON.parse(readFileSync(p, "utf-8")) as CalEvent[];
  } catch {
    return undefined;
  }
}

function saveCache(source: string, dateIso: string, events: CalEvent[]): void {
  try {
    mkdirSync(CACHE_DIR, { recursive: true });
    writeFileSync(cachePath(source, dateIso), JSON.stringify(events), "utf-8");
  } catch {
    // best-effort
  }
}

// ─── Day window helpers ─────────────────────────────────────────────────────

/** Local-midnight epoch ms for "YYYY-MM-DD". */
function dayStartMs(dateIso: string): number {
  const [y, m, d] = dateIso.split("-").map(Number);
  return new Date(y!, (m ?? 1) - 1, d ?? 1, 0, 0, 0, 0).getTime();
}

function dayBoundsIso(dateIso: string): { min: string; max: string } {
  const [y, m, d] = dateIso.split("-").map(Number);
  const min = new Date(y!, (m ?? 1) - 1, d ?? 1, 0, 0, 0, 0);
  const max = new Date(y!, (m ?? 1) - 1, d ?? 1, 23, 59, 59, 999);
  return { min: min.toISOString(), max: max.toISOString() };
}

/** Map an absolute start/end (epoch ms) to minutes since the target day's midnight. */
function toMinutes(startMs: number, endMs: number, base: number): { startMin: number; endMin: number } {
  return {
    startMin: Math.round((startMs - base) / 60000),
    endMin: Math.round((endMs - base) / 60000),
  };
}

// ─── Google ─────────────────────────────────────────────────────────────────

interface GoogleToken {
  token?: string;
  access_token?: string;
  refresh_token?: string;
  token_uri?: string;
  client_id?: string;
  client_secret?: string;
  expiry?: string;
}

/** Refresh the Google access token if missing/expired. Returns a usable token or null. */
async function googleAccessToken(tokenPath: string): Promise<string | null> {
  let tok: GoogleToken;
  try {
    tok = JSON.parse(readFileSync(tokenPath, "utf-8")) as GoogleToken;
  } catch {
    return null;
  }
  const current = tok.token ?? tok.access_token;
  const notExpired = tok.expiry ? Date.parse(tok.expiry) - Date.now() > 60_000 : false;
  if (current && notExpired) return current;

  if (!tok.refresh_token || !tok.client_id || !tok.client_secret) return null;
  const tokenUri = tok.token_uri || "https://oauth2.googleapis.com/token";
  try {
    const res = await fetch(tokenUri, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: tok.client_id,
        client_secret: tok.client_secret,
        refresh_token: tok.refresh_token,
        grant_type: "refresh_token",
      }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { access_token?: string; expires_in?: number };
    if (!data.access_token) return null;
    // Persist the refreshed token so we don't refresh on every fetch.
    try {
      tok.token = data.access_token;
      tok.access_token = data.access_token;
      if (data.expires_in) {
        tok.expiry = new Date(Date.now() + data.expires_in * 1000).toISOString();
      }
      writeFileSync(tokenPath, JSON.stringify(tok), "utf-8");
    } catch {
      // token still usable in-memory even if write-back fails
    }
    return data.access_token;
  } catch {
    return null;
  }
}

async function fetchGoogle(cfg: GoogleCalendarConfig, dateIso: string): Promise<CalEvent[]> {
  const cached = loadCache("google", dateIso);
  if (cached) return cached;

  const access = await googleAccessToken(cfg.token);
  if (!access) return [];
  const headers = { Authorization: `Bearer ${access}` };
  const { min, max } = dayBoundsIso(dateIso);
  const base = dayStartMs(dateIso);
  const fallback = cfg.color || GOOGLE_FALLBACK_COLOR;

  try {
    // Which calendars + their colors.
    const listRes = await fetch(
      "https://www.googleapis.com/calendar/v3/users/me/calendarList?minAccessRole=reader",
      { headers },
    );
    if (!listRes.ok) return [];
    const list = (await listRes.json()) as {
      items?: Array<{ id: string; backgroundColor?: string; selected?: boolean }>;
    };
    const cals = (list.items ?? []).map((c) => ({
      id: c.id,
      color: c.backgroundColor || fallback,
    }));
    if (cals.length === 0) cals.push({ id: "primary", color: fallback });

    const events: CalEvent[] = [];
    const seen = new Set<string>();
    const results = await Promise.all(
      cals.map(async (cal) => {
        try {
          const url =
            `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(cal.id)}/events` +
            `?timeMin=${encodeURIComponent(min)}&timeMax=${encodeURIComponent(max)}` +
            `&singleEvents=true&orderBy=startTime`;
          const r = await fetch(url, { headers });
          if (!r.ok) return [] as Array<{ ev: CalEvent; uid: string }>;
          const data = (await r.json()) as {
            items?: Array<{
              id?: string;
              summary?: string;
              start?: { dateTime?: string; date?: string };
              end?: { dateTime?: string; date?: string };
            }>;
          };
          const out: Array<{ ev: CalEvent; uid: string }> = [];
          for (const it of data.items ?? []) {
            const startRaw = it.start?.dateTime;
            const endRaw = it.end?.dateTime;
            if (!startRaw || !endRaw) continue; // skip all-day (date only)
            const { startMin, endMin } = toMinutes(Date.parse(startRaw), Date.parse(endRaw), base);
            out.push({
              uid: it.id ?? `${cal.id}:${startRaw}`,
              ev: {
                title: it.summary ?? "(no title)",
                startMin,
                endMin,
                color: cal.color,
                source: "google",
              },
            });
          }
          return out;
        } catch {
          return [] as Array<{ ev: CalEvent; uid: string }>;
        }
      }),
    );
    for (const arr of results) {
      for (const { ev, uid } of arr) {
        if (seen.has(uid)) continue;
        seen.add(uid);
        events.push(ev);
      }
    }
    events.sort((a, b) => a.startMin - b.startMin);
    saveCache("google", dateIso, events);
    return events;
  } catch {
    return [];
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Fetch all configured calendar events for the given ISO date (YYYY-MM-DD),
 * mapped to minutes since local midnight. Silent on every failure.
 */
export async function fetchCalendarEvents(
  calendars: CalendarsConfig | undefined,
  dateIso: string,
): Promise<CalEvent[]> {
  if (!calendars) return [];
  const out: CalEvent[] = [];
  if (calendars.google?.enabled && calendars.google.token) {
    out.push(...(await fetchGoogle(calendars.google, dateIso)));
  }
  // Microsoft 365 — wired in phase 2.
  out.sort((a, b) => a.startMin - b.startMin);
  return out;
}

// ─── Reactive store ─────────────────────────────────────────────────────────

export interface CalendarStore {
  events: () => CalEvent[];
  refresh: () => void;
  dispose: () => Promise<void>;
}

/**
 * Reactive store of today's calendar events. Fetches eagerly, then refreshes
 * every 5 minutes (cheap thanks to the 30-min disk cache) — which also picks
 * up the day rollover via the `today` accessor. No-op when no calendars are
 * configured.
 */
export function createCalendarStore(
  calendars: CalendarsConfig | undefined,
  today: () => string,
): CalendarStore {
  const [events, setEvents] = createSignal<CalEvent[]>([]);
  let timer: ReturnType<typeof setInterval> | undefined;

  function refresh(): void {
    if (!calendars) return;
    void fetchCalendarEvents(calendars, today()).then(setEvents).catch(() => {});
  }

  refresh();
  if (calendars) timer = setInterval(refresh, 5 * 60 * 1000);

  async function dispose(): Promise<void> {
    if (timer) clearInterval(timer);
  }

  return { events, refresh, dispose };
}
