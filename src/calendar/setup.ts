/**
 * One-time OAuth setup for the Agenda calendar overlay.
 *
 *   tuiboard calendar-setup google      # browser OAuth (loopback redirect)
 *   tuiboard calendar-setup microsoft   # device-code flow (no redirect)
 *   tuiboard calendar-setup             # show usage
 *
 * Dependency-light: raw `fetch` + the platform browser, no SDKs. Tokens are
 * written to the paths your tuiboard config points at (`calendars.google.token`
 * / `calendars.microsoft.tokenCache`); if there's no `calendars:` block yet we
 * fall back to `~/.config/tuiboard/` and tell you what to add.
 *
 * Runs as a plain CLI (no TUI) — see bin/tuiboard.ts.
 */

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";

import { loadConfig } from "~/config/loader";

const TUIBOARD_DIR = join(homedir(), ".config", "tuiboard");
const GOOGLE_SCOPE_RO = "https://www.googleapis.com/auth/calendar.readonly";
/** Added with `--write`: lets tuiboard CREATE events (and still read them). */
const GOOGLE_SCOPE_EVENTS = "https://www.googleapis.com/auth/calendar.events";
const MS_SCOPE = "Calendars.Read offline_access openid profile";

function expandPath(p: string, root: string): string {
  if (p.startsWith("~")) return join(homedir(), p.slice(1).replace(/^[/\\]/, ""));
  return isAbsolute(p) ? p : resolve(root, p);
}

function openBrowser(url: string): void {
  try {
    if (process.platform === "win32") {
      // NOT `cmd /c start`: cmd treats the `&` in an OAuth URL as a command
      // separator and truncates it (→ Google "invalid_request"). rundll32 gets
      // the URL as a single literal argv, no shell parsing.
      spawn("rundll32", ["url.dll,FileProtocolHandler", url], { detached: true, stdio: "ignore" }).unref();
    } else if (process.platform === "darwin") {
      spawn("open", [url], { detached: true, stdio: "ignore" }).unref();
    } else {
      spawn("xdg-open", [url], { detached: true, stdio: "ignore" }).unref();
    }
  } catch {
    // fall back to the printed URL
  }
}

function writeJson(path: string, data: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(data, null, 2), "utf-8");
}

// ─── Google ─────────────────────────────────────────────────────────────────

interface GoogleClientSecrets {
  client_id?: string;
  client_secret?: string;
  auth_uri?: string;
  token_uri?: string;
}

async function setupGoogle(credsPath: string, tokenPath: string, write: boolean): Promise<number> {
  const scopes = write ? [GOOGLE_SCOPE_RO, GOOGLE_SCOPE_EVENTS] : [GOOGLE_SCOPE_RO];
  console.log("\n── Google Calendar setup ──────────────────────────────────");
  console.log(write ? "Mode: read + create events" : "Mode: read-only (add --write to create events)");
  if (!existsSync(credsPath)) {
    console.log(`OAuth client file not found:\n  ${credsPath}\n
Create it:
  1. Google Cloud Console → APIs & Services → enable "Google Calendar API"
  2. Credentials → Create credentials → OAuth client ID
     Application type: Desktop app
  3. Download the JSON and save it as the path above
  4. Re-run: tuiboard calendar-setup google\n`);
    return 1;
  }

  let secrets: GoogleClientSecrets;
  try {
    const raw = JSON.parse(readFileSync(credsPath, "utf-8")) as {
      installed?: GoogleClientSecrets;
      web?: GoogleClientSecrets;
    } & GoogleClientSecrets;
    secrets = raw.installed ?? raw.web ?? raw;
  } catch {
    console.log(`Could not parse ${credsPath} as JSON.`);
    return 1;
  }
  const clientId = secrets.client_id;
  const clientSecret = secrets.client_secret;
  if (!clientId || !clientSecret) {
    console.log("client_id / client_secret missing from the OAuth client file.");
    return 1;
  }
  // Force the current v2 authorization endpoint. Desktop client_secret files
  // still ship the legacy `/o/oauth2/auth` in `auth_uri`, which returns
  // "Error 400: invalid_request (GeneralOAuthFlow)" for loopback + multi-scope.
  const authUri = "https://accounts.google.com/o/oauth2/v2/auth";
  const tokenUri = secrets.token_uri || "https://oauth2.googleapis.com/token";

  // Loopback server captures the ?code= redirect.
  let resolveResult!: (v: { code?: string; error?: string }) => void;
  const result = new Promise<{ code?: string; error?: string }>((r) => (resolveResult = r));
  const server = Bun.serve({
    port: 0,
    // Bind the IPv4 loopback explicitly. On Windows `localhost` resolves to
    // IPv6 `::1` first; if the server is IPv4-only the redirect is refused.
    // We also use 127.0.0.1 in the redirect URI so the two always match.
    hostname: "127.0.0.1",
    fetch(req) {
      const u = new URL(req.url);
      const code = u.searchParams.get("code") ?? undefined;
      const error = u.searchParams.get("error") ?? undefined;
      if (code || error) {
        const msg = error
          ? `Authorization failed: ${error}`
          : "tuiboard is now connected to Google Calendar. You can close this tab.";
        // Resolve AFTER the response is handed back so the success page has a
        // moment to flush; resolving synchronously lets the caller stop the
        // server before the bytes reach the browser (→ ERR_CONNECTION_REFUSED).
        setTimeout(() => resolveResult({ code, error }), 300);
        return new Response(`<!doctype html><meta charset=utf-8><body style="font:16px system-ui;padding:3rem">${msg}</body>`, {
          headers: { "content-type": "text/html" },
        });
      }
      return new Response("waiting for Google…", { headers: { "content-type": "text/plain" } });
    },
  });
  const redirectUri = `http://127.0.0.1:${server.port}`;
  const authUrl =
    `${authUri}?` +
    new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: scopes.join(" "),
      access_type: "offline",
      prompt: "consent",
    }).toString();

  console.log(`Opening your browser to authorize Google Calendar (${write ? "read + write" : "read-only"})…`);
  console.log(`If it doesn't open, visit:\n  ${authUrl}\n`);
  openBrowser(authUrl);

  const { code, error } = await result;
  server.stop(); // graceful: lets the success page finish sending
  if (error || !code) {
    console.log(`\nSetup cancelled${error ? `: ${error}` : ""}.`);
    return 1;
  }

  const res = await fetch(tokenUri, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });
  if (!res.ok) {
    console.log(`Token exchange failed (${res.status}): ${await res.text()}`);
    return 1;
  }
  const data = (await res.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
  };
  if (!data.access_token || !data.refresh_token) {
    console.log("Google did not return a refresh token. Revoke prior access and retry.");
    return 1;
  }
  writeJson(tokenPath, {
    token: data.access_token,
    refresh_token: data.refresh_token,
    token_uri: tokenUri,
    client_id: clientId,
    client_secret: clientSecret,
    scopes,
    expiry: data.expires_in ? new Date(Date.now() + data.expires_in * 1000).toISOString() : undefined,
  });
  console.log(`\n✓ Google Calendar connected. Token saved:\n  ${tokenPath}\n`);
  return 0;
}

// ─── Microsoft 365 ────────────────────────────────────────────────────────────

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function setupMicrosoft(configPath: string, tokenPath: string): Promise<number> {
  console.log("\n── Microsoft 365 setup ────────────────────────────────────");
  if (!existsSync(configPath)) {
    writeJson(configPath, {
      client_id: "YOUR_AZURE_APP_CLIENT_ID",
      authority: "https://login.microsoftonline.com/common",
    });
    console.log(`Azure config template created:\n  ${configPath}\n
Complete it:
  1. Azure Portal → App registrations → New registration
     Supported accounts: "any org directory and personal Microsoft accounts"
     Redirect URI: Public client/native → http://localhost
  2. Authentication → enable "Allow public client flows"
  3. API permissions → Microsoft Graph → Delegated → Calendars.Read
  4. Put the Application (client) ID into the file above
  5. Re-run: tuiboard calendar-setup microsoft\n`);
    return 1;
  }

  let cfg: { client_id?: string; authority?: string };
  try {
    cfg = JSON.parse(readFileSync(configPath, "utf-8")) as typeof cfg;
  } catch {
    console.log(`Could not parse ${configPath} as JSON.`);
    return 1;
  }
  const clientId = cfg.client_id;
  if (!clientId || clientId === "YOUR_AZURE_APP_CLIENT_ID") {
    console.log(`Set your Azure client_id in ${configPath} first.`);
    return 1;
  }
  const authority = cfg.authority || "https://login.microsoftonline.com/common";

  const dcRes = await fetch(`${authority}/oauth2/v2.0/devicecode`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: clientId, scope: MS_SCOPE }),
  });
  if (!dcRes.ok) {
    console.log(`Failed to start device flow (${dcRes.status}): ${await dcRes.text()}`);
    return 1;
  }
  const dc = (await dcRes.json()) as {
    device_code: string;
    user_code: string;
    verification_uri: string;
    message?: string;
    interval?: number;
    expires_in?: number;
  };
  console.log(`\n  ${dc.message ?? `Go to ${dc.verification_uri} and enter code ${dc.user_code}`}\n`);
  openBrowser(dc.verification_uri);

  const tokenEndpoint = `${authority}/oauth2/v2.0/token`;
  let interval = (dc.interval ?? 5) * 1000;
  const deadline = Date.now() + (dc.expires_in ?? 900) * 1000;
  while (Date.now() < deadline) {
    await sleep(interval);
    const res = await fetch(tokenEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
        client_id: clientId,
        device_code: dc.device_code,
      }),
    });
    const data = (await res.json()) as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
      error?: string;
      error_description?: string;
    };
    if (data.access_token) {
      writeJson(tokenPath, {
        access_token: data.access_token,
        refresh_token: data.refresh_token,
        expiry: data.expires_in
          ? new Date(Date.now() + data.expires_in * 1000).toISOString()
          : undefined,
      });
      console.log(`\n✓ Microsoft 365 connected. Token saved:\n  ${tokenPath}\n`);
      return 0;
    }
    if (data.error === "authorization_pending") continue;
    if (data.error === "slow_down") {
      interval += 5000;
      continue;
    }
    console.log(`\nAuthentication failed: ${data.error_description ?? data.error ?? "unknown error"}`);
    return 1;
  }
  console.log("\nDevice code expired before authorization. Re-run to try again.");
  return 1;
}

// ─── Entry ────────────────────────────────────────────────────────────────────

function usage(): void {
  console.log(`tuiboard calendar-setup — connect a calendar to the Agenda overlay

Usage:
  tuiboard calendar-setup google           Browser OAuth, read-only
  tuiboard calendar-setup google --write   Browser OAuth, read + create events
  tuiboard calendar-setup microsoft        Device-code flow for Microsoft 365

Tokens are written to the paths in your tuiboard config (calendars.google.token
/ calendars.microsoft.tokenCache), or ~/.config/tuiboard/ if no calendars block
exists yet. After connecting, add the matching block to your config — the setup
prints the exact YAML.`);
}

export async function runCalendarSetup(argv: string[]): Promise<number> {
  const write = argv.includes("--write");
  const provider = (argv.find((a) => !a.startsWith("--")) ?? "").toLowerCase();
  const cfg = loadConfig();
  const root = cfg.root;

  if (provider === "google") {
    const g = cfg.calendars?.google;
    const credsPath = g?.credentials
      ? expandPath(g.credentials, root)
      : join(TUIBOARD_DIR, "google_credentials.json");
    const tokenPath = g?.token ? expandPath(g.token, root) : join(TUIBOARD_DIR, "google_token.json");
    const rc = await setupGoogle(credsPath, tokenPath, write);
    if (rc === 0 && !g) {
      console.log(`Add this to your tuiboard config (${cfg.loaded ? "config found" : "create ~/.config/tuiboard/config.yaml"}):

calendars:
  google:
    enabled: true
    token: ${tokenPath}
`);
    }
    return rc;
  }

  if (provider === "microsoft" || provider === "ms" || provider === "ms365") {
    const m = cfg.calendars?.microsoft;
    const configPath = m?.config ? expandPath(m.config, root) : join(TUIBOARD_DIR, "azure_config.json");
    const tokenPath = m?.tokenCache
      ? expandPath(m.tokenCache, root)
      : join(TUIBOARD_DIR, "ms_token.json");
    const rc = await setupMicrosoft(configPath, tokenPath);
    if (rc === 0 && !m) {
      console.log(`Add this to your tuiboard config:

calendars:
  microsoft:
    enabled: true
    config: ${configPath}
    token_cache: ${tokenPath}
`);
    }
    return rc;
  }

  usage();
  return provider ? 1 : 0;
}
