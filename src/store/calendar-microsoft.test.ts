import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  calendarWriteEnabled,
  createMicrosoftEvent,
  deleteMicrosoftEvent,
  listMicrosoftCalendars,
  microsoftTokenCanWrite,
  updateMicrosoftEvent,
} from "./calendar";

let dir: string;
let cfg: { enabled: boolean; config: string; tokenCache: string };
const realFetch = globalThis.fetch;
let calls: Array<{ url: string; init?: RequestInit }>;
let respond: (url: string, init?: RequestInit) => Response;

function writeToken(scope?: string): void {
  writeFileSync(
    cfg.tokenCache,
    JSON.stringify({
      access_token: "tok",
      refresh_token: "ref",
      expiry: new Date(Date.now() + 3600_000).toISOString(),
      ...(scope ? { scope } : {}),
    }),
  );
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "tb-ms-"));
  cfg = { enabled: true, config: join(dir, "azure.json"), tokenCache: join(dir, "tok.json") };
  writeFileSync(cfg.config, JSON.stringify({ client_id: "cid" }));
  calls = [];
  respond = () => new Response(null, { status: 204 });
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return respond(String(url), init);
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
  rmSync(dir, { recursive: true, force: true });
});

describe("microsoftTokenCanWrite / calendarWriteEnabled", () => {
  it("is false for a read-only token and true once Calendars.ReadWrite was granted", () => {
    writeToken("Calendars.Read offline_access");
    expect(microsoftTokenCanWrite(cfg.tokenCache)).toBe(false);
    expect(calendarWriteEnabled({ microsoft: cfg })).toBe(false);
    writeToken("Calendars.ReadWrite offline_access");
    expect(microsoftTokenCanWrite(cfg.tokenCache)).toBe(true);
    expect(calendarWriteEnabled({ microsoft: cfg })).toBe(true);
  });

  it("is false for a missing token file or a token without a recorded scope", () => {
    expect(microsoftTokenCanWrite(join(dir, "nope.json"))).toBe(false);
    writeToken();
    expect(microsoftTokenCanWrite(cfg.tokenCache)).toBe(false);
  });
});

describe("Microsoft event writes", () => {
  it("refuses to write with a read-only token and makes no Graph call", async () => {
    writeToken("Calendars.Read offline_access");
    const r = await deleteMicrosoftEvent(cfg, { eventId: "e1" });
    expect(r).toEqual({ ok: false, error: expect.stringContaining("calendar-setup microsoft --write") });
    expect(calls).toHaveLength(0);
  });

  it("creates a timed event on the default calendar with exact UTC instants", async () => {
    writeToken("Calendars.ReadWrite offline_access");
    const r = await createMicrosoftEvent(cfg, {
      calendarId: "default",
      title: "Lunch",
      dateIso: "2026-06-03",
      startMin: 12 * 60,
      endMin: 13 * 60,
    });
    expect(r).toEqual({ ok: true });
    expect(calls[0]!.url).toBe("https://graph.microsoft.com/v1.0/me/calendar/events");
    expect(calls[0]!.init?.method).toBe("POST");
    const body = JSON.parse(String(calls[0]!.init?.body));
    expect(body.subject).toBe("Lunch");
    expect(body.start.timeZone).toBe("UTC");
    const start = Date.parse(`${body.start.dateTime}Z`);
    const end = Date.parse(`${body.end.dateTime}Z`);
    expect(end - start).toBe(60 * 60000);
    const localNoon = new Date(2026, 5, 3, 12, 0).getTime();
    expect(start).toBe(localNoon);
  });

  it("creates an all-day event with an exclusive end date", async () => {
    writeToken("Calendars.ReadWrite offline_access");
    await createMicrosoftEvent(cfg, {
      calendarId: "AAA=",
      title: "Holiday",
      dateIso: "2026-12-25",
      startMin: 0,
      endMin: 0,
      allDay: true,
    });
    expect(calls[0]!.url).toBe("https://graph.microsoft.com/v1.0/me/calendars/AAA%3D/events");
    const body = JSON.parse(String(calls[0]!.init?.body));
    expect(body.isAllDay).toBe(true);
    expect(body.start.dateTime).toBe("2026-12-25T00:00:00");
    expect(body.end.dateTime).toBe("2026-12-26T00:00:00");
  });

  it("edits with PATCH on the event id and surfaces Graph errors", async () => {
    writeToken("Calendars.ReadWrite offline_access");
    respond = () => new Response("Forbidden", { status: 403 });
    const r = await updateMicrosoftEvent(cfg, {
      eventId: "ev/1",
      title: "Review",
      dateIso: "2026-06-03",
      startMin: 600,
      endMin: 660,
    });
    expect(calls[0]!.url).toBe("https://graph.microsoft.com/v1.0/me/events/ev%2F1");
    expect(calls[0]!.init?.method).toBe("PATCH");
    expect(r).toEqual({ ok: false, error: "403 Forbidden" });
  });

  it("treats DELETE of an already-removed event (404) as success", async () => {
    writeToken("Calendars.ReadWrite offline_access");
    respond = () => new Response(null, { status: 404 });
    expect(await deleteMicrosoftEvent(cfg, { eventId: "gone" })).toEqual({ ok: true });
    expect(calls[0]!.init?.method).toBe("DELETE");
  });
});

describe("listMicrosoftCalendars", () => {
  it("offers only the editable default calendar (the one the Agenda reads)", async () => {
    writeToken("Calendars.ReadWrite offline_access");
    respond = () =>
      new Response(
        JSON.stringify({
          value: [
            { id: "a", name: "Calendar", isDefaultCalendar: true, canEdit: true, hexColor: "#112233" },
            { id: "b", name: "Birthdays", isDefaultCalendar: false, canEdit: true },
          ],
        }),
        { status: 200 },
      );
    const cals = await listMicrosoftCalendars(cfg);
    expect(cals).toHaveLength(1);
    expect(cals[0]).toMatchObject({ source: "microsoft", id: "a", color: "#112233" });
  });
});
