#!/usr/bin/env bun
/**
 * Global entry point for `tuiboard` after `bun link` / `bun install -g`.
 *
 * Bun resolves the package's "bin" entry to this file, then runs it with
 * `bun --preload` semantics inherited from the shebang. We just re-export
 * the app bootstrap — the actual work lives in src/app.tsx.
 *
 * The preload of @opentui/solid/preload is normally provided by
 * `bun run dev`. For the linked binary, we add it programmatically here
 * so a fresh user doesn't need to remember the flag.
 */

// @ts-expect-error — Bun-specific runtime hook, no TS types yet.
import "@opentui/solid/preload";
import "../src/app.tsx";
