# Calendar Sync

A local web app that merges Outlook (USC Microsoft 365) and Google Calendar into one unified view.

## Status: Phase 1–2 complete, Phase 3+ not started

- Outlook ICS feed integration (read-only): working
- Google Calendar OAuth integration (read/write): working
- Merged, sorted event display: working
- Week/day/month/agenda views, drag-to-move and drag-to-resize (Google events only): working
- Create/edit/delete Google events, custom event colors: working
- Meeting-link detection (Zoom/Teams/Meet), search, keyboard shortcuts (m/w/d): working
- Browser notifications with app-generated chime, background sync every 10 min: working
- Conflict detection, AI scheduling: not started

## Architecture

```
Outlook (ICS feed) ---\
                        > merged in page.tsx --> React UI
Google Calendar (OAuth)-/
```

Two independent API routes fetch and normalize events into the same shape:

```ts
{ summary: string, start: string, end: string, location: string | null }
```

`page.tsx` calls both routes, tags each event with its source, merges the arrays, sorts by start time, and renders the next 30 upcoming events.

## Folder structure

```
src/app/
  page.tsx                       merged UI, fetches both APIs client-side
  api/
    outlook/route.ts             fetches + parses Outlook ICS feed
    google/
      login/route.ts             redirects to Google OAuth consent screen
      callback/route.ts          exchanges auth code for tokens, saves to .tokens.json
      events/route.ts            refreshes token, fetches events from Google Calendar API
```

## Environment variables (.env.local, gitignored)

```
OUTLOOK_ICS_URL=          # USC Outlook published calendar ICS link
GOOGLE_CLIENT_ID=         # from Google Cloud Console OAuth client
GOOGLE_CLIENT_SECRET=     # from Google Cloud Console OAuth client
GOOGLE_REDIRECT_URI=http://localhost:3001/api/google/callback
```

Google Cloud project: `calendar-sync-502204`, OAuth client type: Web application, user type: Internal (org-restricted, no verification needed).

## Local secrets (gitignored)

`.tokens.json` is created after first Google login. Contains `access_token`, `refresh_token`, `expires_in`, `scope`. The `events` route auto-refreshes the access token on every request using the stored refresh token, so no repeat login is needed unless the refresh token itself is revoked.

## Setup steps (fresh machine)

1. `npm install`
2. Create `.env.local` with the four variables above
3. `npm run dev` (runs on port 3001 if 3000 is taken)
4. Visit `http://localhost:3001/api/google/login` once to generate `.tokens.json`
5. Visit `http://localhost:3001` to see the merged calendar

## Known issues / notes

- Outlook ICS parser required manual unescaping of `\,` and `\;` characters (standard ICS escaping). Fixed in `outlook/route.ts` via `.replace()` after parsing.
- Google events route fetches a 90-day window; Outlook route currently returns the full feed unfiltered. If performance becomes an issue, add a date range filter to the Outlook route too.
- No error handling yet for expired/revoked Google refresh tokens beyond a generic failed fetch. Would need to detect a 401 and redirect back to `/api/google/login`.

## Next milestones

- Phase 3: conflict detection between Outlook and Google events
- Phase 4: AI scheduling suggestions, natural language search
- Phase 5: production deployment (will require moving off ICS + local `.tokens.json` toward a database-backed token store, since production can't rely on local disk persistence)
