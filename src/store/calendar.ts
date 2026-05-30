/**
 * Read-only calendar feeds for the Agenda (timeline) zone.
 *
 * Dependency-light: raw `fetch` + direct OAuth token refresh, no SDKs. Reads
 * the token files written by `tuiboard calendar-setup` (`google_token.json`
 * for Google; `azure_config.json` + `ms_token.json` for Microsoft).
 *
 * Every fetch fails silently (returns []): a missing/expired/unconfigured
 * calendar must never break the board.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { createSignal } from "solid-js";

import type {
  CalendarsConfig,
  GoogleCalendarConfig,
  MicrosoftCalendarConfig,
} from "~/config/loader";

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
const MS_FALLBACK_COLOR = "#b39ddb";
const MS_GRAPH_SCOPE = "Calendars.Read offline_access";
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

async function fetchGoogle(
  cfg: GoogleCalendarConfig,
  dateIso: string,
  force = false,
): Promise<CalEvent[]> {
  if (!force) {
    const cached = loadCache("google", dateIso);
    if (cached) return cached;
  }

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

// ─── Microsoft 365 ────────────────────────────────────────────────────────────

interface AzureConfig {
  client_id?: string;
  authority?: string;
}

interface MsToken {
  access_token?: string;
  refresh_token?: string;
  expiry?: string;
}

/**
 * Refresh the Microsoft Graph access token if missing/expired. Returns a usable
 * token or null. Reads the Azure app config (client_id + authority) and the
 * token file written by `tuiboard calendar-setup microsoft`.
 */
async function microsoftAccessToken(cfg: MicrosoftCalendarConfig): Promise<string | null> {
  let azure: AzureConfig;
  try {
    azure = JSON.parse(readFileSync(cfg.config, "utf-8")) as AzureConfig;
  } catch {
    return null;
  }
  const clientId = azure.client_id;
  if (!clientId || clientId === "YOUR_AZURE_APP_CLIENT_ID") return null;
  const authority = azure.authority || "https://login.microsoftonline.com/common";

  let tok: MsToken;
  try {
    tok = JSON.parse(readFileSync(cfg.tokenCache, "utf-8")) as MsToken;
  } catch {
    return null;
  }
  const notExpired = tok.expiry ? Date.parse(tok.expiry) - Date.now() > 60_000 : false;
  if (tok.access_token && notExpired) return tok.access_token;
  if (!tok.refresh_token) return null;

  try {
    const res = await fetch(`${authority}/oauth2/v2.0/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        grant_type: "refresh_token",
        refresh_token: tok.refresh_token,
        scope: MS_GRAPH_SCOPE,
      }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
    };
    if (!data.access_token) return null;
    try {
      tok.access_token = data.access_token;
      if (data.refresh_token) tok.refresh_token = data.refresh_token;
      if (data.expires_in) tok.expiry = new Date(Date.now() + data.expires_in * 1000).toISOString();
      writeFileSync(cfg.tokenCache, JSON.stringify(tok), "utf-8");
    } catch {
      // token still usable in-memory even if write-back fails
    }
    return data.access_token;
  } catch {
    return null;
  }
}

/** Append a `Z` to a Graph dateTime that has no timezone designator. */
function ensureUtc(s: string): string {
  if (s.endsWith("Z") || /[+-]\d\d:\d\d$/.test(s)) return s;
  return `${s}Z`;
}

async function fetchMicrosoft(
  cfg: MicrosoftCalendarConfig,
  dateIso: string,
  force = false,
): Promise<CalEvent[]> {
  if (!force) {
    const cached = loadCache("microsoft", dateIso);
    if (cached) return cached;
  }

  const access = await microsoftAccessToken(cfg);
  if (!access) return [];
  const base = dayStartMs(dateIso);
  const { min, max } = dayBoundsIso(dateIso);
  const color = cfg.color || MS_FALLBACK_COLOR;

  try {
    const url =
      "https://graph.microsoft.com/v1.0/me/calendarView" +
      `?startDateTime=${encodeURIComponent(min)}&endDateTime=${encodeURIComponent(max)}` +
      `&%24orderby=${encodeURIComponent("start/dateTime")}&%24top=50`;
    const r = await fetch(url, {
      headers: {
        Authorization: `Bearer ${access}`,
        // Ask Graph to return times in UTC so our base-offset math is exact.
        Prefer: 'outlook.timezone="UTC"',
      },
    });
    if (!r.ok) return [];
    const data = (await r.json()) as {
      value?: Array<{
        subject?: string;
        isAllDay?: boolean;
        start?: { dateTime?: string };
        end?: { dateTime?: string };
      }>;
    };
    const events: CalEvent[] = [];
    for (const it of data.value ?? []) {
      if (it.isAllDay) continue; // mirror Google: skip all-day events
      const s = it.start?.dateTime;
      const e = it.end?.dateTime;
      if (!s || !e) continue;
      const { startMin, endMin } = toMinutes(Date.parse(ensureUtc(s)), Date.parse(ensureUtc(e)), base);
      events.push({
        title: it.subject ?? "(no title)",
        startMin,
        endMin,
        color,
        source: "microsoft",
      });
    }
    events.sort((a, b) => a.startMin - b.startMin);
    saveCache("microsoft", dateIso, events);
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
  force = false,
): Promise<CalEvent[]> {
  if (!calendars) return [];
  const out: CalEvent[] = [];
  const tasks: Array<Promise<CalEvent[]>> = [];
  if (calendars.google?.enabled && calendars.google.token) {
    tasks.push(fetchGoogle(calendars.google, dateIso, force));
  }
  if (calendars.microsoft?.enabled && calendars.microsoft.config && calendars.microsoft.tokenCache) {
    tasks.push(fetchMicrosoft(calendars.microsoft, dateIso, force));
  }
  for (const arr of await Promise.all(tasks)) out.push(...arr);
  out.sort((a, b) => a.startMin - b.startMin);
  return out;
}

// ─── Reactive store ─────────────────────────────────────────────────────────

export interface CalendarStore {
  /** Events for the currently active date. */
  events: () => CalEvent[];
  /** Switch which date's events `events()` exposes; fetches it (cache-first). */
  setActiveDate: (dateIso: string) => void;
  /**
   * Re-fetch the active date now (the 5-min interval calls this too). Pass
   * `force` to bypass the 30-min disk cache — used by the manual `r` refresh
   * so freshly-edited events show without waiting for the cache to expire.
   */
  refresh: (force?: boolean) => void;
  dispose: () => Promise<void>;
}

/**
 * Reactive store of one day's calendar events at a time — the "active date",
 * driven by the Agenda's day-navigation. Fetches eagerly for the initial date,
 * refreshes the active date every 5 minutes (cheap thanks to the 30-min disk
 * cache), and re-fetches immediately when the active date changes. No-op when
 * no calendars are configured.
 */
export function createCalendarStore(
  calendars: CalendarsConfig | undefined,
  initialDate: () => string,
): CalendarStore {
  const [events, setEvents] = createSignal<CalEvent[]>([]);
  let activeDate = initialDate();
  let timer: ReturnType<typeof setInterval> | undefined;

  function refresh(force = false): void {
    if (!calendars) return;
    const target = activeDate;
    void fetchCalendarEvents(calendars, target, force)
      .then((evs) => {
        // Guard against out-of-order resolves when the user pages quickly:
        // only apply if this is still the date the user is looking at.
        if (target === activeDate) setEvents(evs);
      })
      .catch(() => {});
  }

  function setActiveDate(dateIso: string): void {
    if (dateIso === activeDate) return;
    activeDate = dateIso;
    setEvents([]); // drop stale events immediately; the fetch repopulates
    refresh();
  }

  refresh();
  if (calendars) timer = setInterval(refresh, 5 * 60 * 1000);

  async function dispose(): Promise<void> {
    if (timer) clearInterval(timer);
  }

  return { events, setActiveDate, refresh, dispose };
}
