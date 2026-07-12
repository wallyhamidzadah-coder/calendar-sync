import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

export async function GET() {
  const tokenPath = path.join(process.cwd(), '.tokens.json');

  if (!fs.existsSync(tokenPath)) {
    return NextResponse.json(
      { error: 'No tokens found. Visit /api/google/login first.' },
      { status: 401 }
    );
  }

  let tokens = JSON.parse(fs.readFileSync(tokenPath, 'utf-8'));

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

  const refreshRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId!,
      client_secret: clientSecret!,
      refresh_token: tokens.refresh_token,
      grant_type: 'refresh_token',
    }),
  });

  if (refreshRes.ok) {
    const refreshed = await refreshRes.json();
    tokens = { ...tokens, ...refreshed };
    fs.writeFileSync(tokenPath, JSON.stringify(tokens, null, 2));
  }

  const now = new Date();
  const future = new Date();
  future.setDate(future.getDate() + 90);

  const params = new URLSearchParams({
    timeMin: now.toISOString(),
    timeMax: future.toISOString(),
    singleEvents: 'true',
    orderBy: 'startTime',
    maxResults: '100',
  });

  const calRes = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/primary/events?${params.toString()}`,
    {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    }
  );

  if (!calRes.ok) {
    const errText = await calRes.text();
    return NextResponse.json(
      { error: 'Failed to fetch Google Calendar events', detail: errText },
      { status: 500 }
    );
  }

  const data = await calRes.json();

  const events = (data.items || []).map((e: any) => ({
    id: e.id,
    summary: e.summary || '(No title)',
    start: e.start?.dateTime || e.start?.date,
    end: e.end?.dateTime || e.end?.date,
    location: e.location || null,
  }));

  return NextResponse.json({ status: 'success', count: events.length, events });
}
