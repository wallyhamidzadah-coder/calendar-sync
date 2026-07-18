@AGENTS.md

# Calendar Sync — agent playbook

A local single-user Next.js app that merges USC Outlook (ICS feed, read-only) and Google Calendar
(OAuth, fully editable) into one `react-big-calendar` view. No backend database — auth tokens live
in a gitignored local JSON file. Built for one user (hardcoded email below), not multi-tenant.

## Current state (verify against `git log` before trusting this — it drifts)

Working: merged Outlook+Google view, week/day/month/agenda views, drag-to-move and drag-to-resize
(Google events only), create/edit/delete Google events, custom event colors, meeting-link detection
(Zoom/Teams/Meet), browser notifications with an app-generated chime, keyboard shortcuts (`m`/`w`/`d`
for view switching), background sync every 10 min.

Not started: any second calendar account, conflict detection, AI scheduling, natural-language
search, production deployment (auth currently depends on local disk — see Known constraints).

Do not trust README.md's "Status"/"Next milestones" sections as current — they lag behind the code.
If you materially change what's implemented, update README.md's status section in the same change.

## Architecture

```
Outlook (ICS feed, read-only)  ---\
                                    > merged client-side in page.tsx --> react-big-calendar UI
Google Calendar (OAuth, read/write)-/
```

- `src/app/page.tsx` — the entire UI. One client component (~1000 lines): fetches both sources,
  merges/filters/sorts events, renders the calendar, event modal, create/edit form, notifications.
  There is no component decomposition yet — this is the existing convention, not an oversight.
  Don't split it into subcomponents as a drive-by refactor; only do it if the user asks.
- `src/app/api/outlook/route.ts` — fetches + parses the Outlook ICS feed server-side (handles
  Windows timezone IDs, RRULE recurrence expansion via `rrule`, manual `\,`/`\;` ICS unescaping).
- `src/app/api/google/{login,callback,events,create,update,delete}/route.ts` — one route per
  operation. `login` redirects to Google's consent screen; `callback` exchanges the code and writes
  `.tokens.json`; the other four call the Calendar API using a freshly refreshed access token.

## Conventions (implicit in the code — make them explicit when you write more of it)

- **API response shape.** Success: `{ status: 'success', ...payload }`. Failure: `{ error: string,
  detail?: string }` with a non-2xx HTTP status — note there is **no** `status` field on error
  responses. Client code checks `data.status !== 'success'` to detect failure; it does not check for
  an `error` field. Keep new routes consistent with this or the client's error branch silently won't
  fire.
- **Token refresh is copy-pasted, not shared.** `events`, `create`, `update`, and `delete` routes
  each read `.tokens.json`, POST to Google's refresh endpoint, and write the merged tokens back,
  independently. This is duplicated on purpose so far (no shared lib exists) — if you add a new
  Google-writing route, copy the existing pattern from `update/route.ts` rather than inventing a new
  one. If asked to deduplicate, extract to `src/lib/googleTokens.ts`, but don't do this unprompted.
- **`MY_EMAIL` is hardcoded** (`wally.hamidzadah.2027@marshall.usc.edu`) independently in
  `page.tsx`, `api/outlook/route.ts`, and `api/google/events/route.ts` — used only to detect "do
  other attendees exist besides me." It is not read from `.env.local`. Don't silently move it to an
  env var; ask first, since it'd touch three files for a single-user app that may not need the
  flexibility.
- **Google events are the only editable ones.** Outlook events are always view-only (draggable/
  resizable/editable accessors gate on `event.source === 'Google'`). Never wire up write actions for
  Outlook events — there is no Outlook write API integration, only the ICS read feed.
- **Styling is inline `style={}` objects with a hardcoded dark palette** (`#1a2230`, `#2f3a4d`,
  etc.), not Tailwind utility classes, despite Tailwind being installed and used for two CSS
  variables in `globals.css`. Match the existing inline-style approach in `page.tsx` and
  `calendar-overrides.css`; don't introduce Tailwind classes into that file without asking — it'd mix
  two styling systems.
- **No light mode.** The app is dark-theme-only by construction (not a `prefers-color-scheme` toggle
  in `page.tsx`). `globals.css` has a stale light/dark media query left over from `create-next-app`
  scaffolding that page.tsx's inline styles override entirely — don't treat that file as the source
  of truth for theme colors.
- **Client-side data merge, not server-side.** `page.tsx` calls both API routes and merges/sorts in
  the browser. New data sources should follow the same pattern (a `route.ts` that normalizes to
  `{ summary, start, end, location }`-shaped JSON, merged in `page.tsx`) unless told otherwise.

## Known constraints (don't "fix" these without asking — they're documented tradeoffs)

- `.tokens.json` is a local file, not a database. This breaks on any hosting environment without
  persistent disk. Production deploy would need a real token store — that's Phase 5, not started.
  Don't add production-deploy config (Vercel, Docker, etc.) assuming this file will survive.
- No 401/expired-refresh-token handling — a revoked Google refresh token just surfaces as a generic
  failed fetch. Known gap, not a bug to silently patch with a broad try/catch.
- Outlook route fetches the full unfiltered ICS feed; Google route windows to -30/+90 days. If you
  touch the Outlook route for performance, match Google's windowing rather than inventing new bounds.

## Definition of done

A change is done when:
1. `npm run lint` passes with no new warnings.
2. `npx tsc --noEmit` passes (this repo has no separate typecheck script — run tsc directly).
3. You started the app (`npm run dev`) and exercised the actual UI path you touched — this project
   has **no test suite** (no test runner is installed), so manual verification in the browser is the
   only correctness check available. State plainly if you could not do this (e.g., no Google auth
   available in your environment) rather than claiming success.
4. If you touched anything under `api/google/*`, confirm you didn't change the response-shape
   convention above (`status: 'success'` on success, bare `error` on failure) — the client relies on
   it exactly as described.
5. If your change affects what's implemented vs. planned, update README.md's "Status" and "Next
   milestones" sections to match — don't let it drift further.
6. Never commit `.env.local` or `.tokens.json` (both gitignored already — don't remove them from
   `.gitignore`, and double check `git status` before any commit touches config files).

## Setup (for running/testing changes locally)

1. `npm install`
2. `.env.local` needs `OUTLOOK_ICS_URL`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`,
   `GOOGLE_REDIRECT_URI` — see README.md for details. You will not have real values for these; if a
   task requires live Outlook/Google data, say so instead of fabricating a workaround.
3. `npm run dev`, visit `/api/google/login` once to generate `.tokens.json`, then `/`.
