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
  /** Google calendar id this event lives on (set for Google events only). */
  calendarId?: string;
  /** Google event id (set for Google events only). Needed to edit/delete. */
  eventId?: string;
  /** True when this event can be edited/deleted from tuiboard: a Google event
   *  on an owner/writer calendar, with a write-scoped token. Microsoft events
   *  and read-only-calendar events are never editable. */
  editable?: boolean;
  /** All-day event (date-only, no time). Rendered as a chip at the top of the
   *  Agenda rather than on the 24h grid; startMin/endMin are unused. Display
   *  only — not editable from tuiboard. */
  allDay?: boolean;
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

// ─── Google write (calendar list + event creation) ──────────────────────────

/** A calendar the connected account can write to (accessRole owner/writer). */
export interface WritableCalendar {
  id: string;
  summary: string;
  accessRole: string;
  color: string;
  primary: boolean;
}

/**
 * List the calendars the connected Google account can WRITE to (owner/writer),
 * with display name + color. Used by the new-event calendar picker. Returns []
 * on any failure. (Read path `fetchGoogle` keeps its own, reader-scoped query.)
 */
export async function listGoogleCalendars(
  cfg: GoogleCalendarConfig,
): Promise<WritableCalendar[]> {
  const access = await googleAccessToken(cfg.token);
  if (!access) return [];
  try {
    const res = await fetch(
      "https://www.googleapis.com/calendar/v3/users/me/calendarList",
      { headers: { Authorization: `Bearer ${access}` } },
    );
    if (!res.ok) return [];
    const list = (await res.json()) as {
      items?: Array<{
        id: string;
        summary?: string;
        accessRole?: string;
        backgroundColor?: string;
        primary?: boolean;
      }>;
    };
    return (list.items ?? [])
      .filter((c) => c.accessRole === "owner" || c.accessRole === "writer")
      .map((c) => ({
        id: c.id,
        summary: c.summary ?? c.id,
        accessRole: c.accessRole ?? "reader",
        color: c.backgroundColor || cfg.color || GOOGLE_FALLBACK_COLOR,
        primary: c.primary === true,
      }));
  } catch {
    return [];
  }
}

/** True if the persisted Google token carries an event-write scope. Gates the
 *  whole event-creation UI so read-only users never see it. */
export function googleTokenCanWrite(tokenPath: string): boolean {
  try {
    const tok = JSON.parse(readFileSync(tokenPath, "utf-8")) as { scopes?: string[] };
    return (
      Array.isArray(tok.scopes) &&
      tok.scopes.some((s) => s.includes("calendar.events") || s.endsWith("/auth/calendar"))
    );
  } catch {
    return false;
  }
}

/** RFC3339 timestamp with the LOCAL UTC offset for `min` minutes past local
 *  midnight of `dateIso` — e.g. "2026-06-03T15:00:00+02:00". Per-instant offset,
 *  so DST is handled; Google then stores the wall-clock time exactly as typed. */
function localRfc3339(dateIso: string, min: number): string {
  const d = new Date(dayStartMs(dateIso) + min * 60000);
  const pad = (n: number) => String(n).padStart(2, "0");
  const offMin = -d.getTimezoneOffset(); // minutes east of UTC
  const sign = offMin >= 0 ? "+" : "-";
  const off = Math.abs(offMin);
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}:00` +
    `${sign}${pad(Math.floor(off / 60))}:${pad(off % 60)}`
  );
}

/** The day after `dateIso` (YYYY-MM-DD). Google all-day events use an EXCLUSIVE
 *  end date, so a single-day all-day event ends on the following day. */
function nextDayIso(dateIso: string): string {
  const d = new Date(dayStartMs(dateIso) + 24 * 60 * 60000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * Create a Google Calendar event on `calendarId`. Unlike the read path, this
 * surfaces failures (returns {ok:false,error}) so the UI can flash a banner.
 * Pass `allDay` for a date-only event (start/end as dates, end exclusive).
 */
export async function createGoogleEvent(
  cfg: GoogleCalendarConfig,
  args: { calendarId: string; title: string; dateIso: string; startMin: number; endMin: number; allDay?: boolean },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const access = await googleAccessToken(cfg.token);
  if (!access) {
    return { ok: false, error: "not authorized — run: tuiboard calendar-setup google --write" };
  }
  try {
    const body = args.allDay
      ? {
          summary: args.title,
          start: { date: args.dateIso },
          end: { date: nextDayIso(args.dateIso) },
        }
      : {
          summary: args.title,
          start: { dateTime: localRfc3339(args.dateIso, args.startMin) },
          end: { dateTime: localRfc3339(args.dateIso, args.endMin) },
        };
    const res = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(args.calendarId)}/events`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${access}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
    );
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return { ok: false, error: `${res.status} ${body.slice(0, 140)}` };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

/**
 * Edit an existing Google Calendar event's title + time (same calendar — moving
 * an event between calendars is intentionally not supported). PATCH so untouched
 * fields (attendees, description, recurrence, …) are preserved.
 */
export async function updateGoogleEvent(
  cfg: GoogleCalendarConfig,
  args: { calendarId: string; eventId: string; title: string; dateIso: string; startMin: number; endMin: number },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const access = await googleAccessToken(cfg.token);
  if (!access) {
    return { ok: false, error: "not authorized — run: tuiboard calendar-setup google --write" };
  }
  try {
    const res = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(args.calendarId)}/events/${encodeURIComponent(args.eventId)}`,
      {
        method: "PATCH",
        headers: { Authorization: `Bearer ${access}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          summary: args.title,
          start: { dateTime: localRfc3339(args.dateIso, args.startMin) },
          end: { dateTime: localRfc3339(args.dateIso, args.endMin) },
        }),
      },
    );
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return { ok: false, error: `${res.status} ${body.slice(0, 140)}` };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

/** Delete a Google Calendar event. DELETE returns 204 (no body) on success. */
export async function deleteGoogleEvent(
  cfg: GoogleCalendarConfig,
  args: { calendarId: string; eventId: string },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const access = await googleAccessToken(cfg.token);
  if (!access) {
    return { ok: false, error: "not authorized — run: tuiboard calendar-setup google --write" };
  }
  try {
    const res = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(args.calendarId)}/events/${encodeURIComponent(args.eventId)}`,
      { method: "DELETE", headers: { Authorization: `Bearer ${access}` } },
    );
    // 410 Gone = already deleted; treat as success (the goal state is reached).
    if (!res.ok && res.status !== 410) {
      const body = await res.text().catch(() => "");
      return { ok: false, error: `${res.status} ${body.slice(0, 140)}` };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e) };
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
      items?: Array<{ id: string; backgroundColor?: string; selected?: boolean; accessRole?: string }>;
    };
    // Events are editable only with a write-scoped token AND on a calendar the
    // account owns/can-write. Computed once here, stamped on each event below.
    const canWrite = googleTokenCanWrite(cfg.token);
    const cals = (list.items ?? []).map((c) => ({
      id: c.id,
      color: c.backgroundColor || fallback,
      writable: canWrite && (c.accessRole === "owner" || c.accessRole === "writer"),
    }));
    if (cals.length === 0) cals.push({ id: "primary", color: fallback, writable: false });

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
            if (!startRaw || !endRaw) {
              // All-day / date-only event: the per-day query already scoped it
              // to a day it covers, so just surface it as a chip (display only).
              const dayKey = it.start?.date;
              if (!dayKey) continue;
              out.push({
                uid: it.id ?? `${cal.id}:allday:${dayKey}`,
                ev: {
                  title: it.summary ?? "(no title)",
                  startMin: 0,
                  endMin: 0,
                  color: cal.color,
                  source: "google",
                  allDay: true,
                },
              });
              continue;
            }
            const { startMin, endMin } = toMinutes(Date.parse(startRaw), Date.parse(endRaw), base);
            out.push({
              uid: it.id ?? `${cal.id}:${startRaw}`,
              ev: {
                title: it.summary ?? "(no title)",
                startMin,
                endMin,
                color: cal.color,
                source: "google",
                calendarId: cal.id,
                eventId: it.id,
                editable: cal.writable && !!it.id,
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
      if (it.isAllDay) {
        // All-day event → chip at the top of the Agenda (display only).
        events.push({
          title: it.subject ?? "(no title)",
          startMin: 0,
          endMin: 0,
          color,
          source: "microsoft",
          allDay: true,
        });
        continue;
      }
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
