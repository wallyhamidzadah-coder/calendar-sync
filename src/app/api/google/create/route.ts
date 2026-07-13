import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

async function getFreshAccessToken() {
  const tokenPath = path.join(process.cwd(), '.tokens.json');
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

  return tokens.access_token;
}

export async function POST(req: Request) {
  const tokenPath = path.join(process.cwd(), '.tokens.json');

  if (!fs.existsSync(tokenPath)) {
    return NextResponse.json(
      { error: 'No tokens found. Visit /api/google/login first.' },
      { status: 401 }
    );
  }

  const body = await req.json();
  const { summary, start, end, location, customColor } = body;

  if (!summary || !start || !end) {
    return NextResponse.json(
      { error: 'Missing required fields: summary, start, end' },
      { status: 400 }
    );
  }

  const accessToken = await getFreshAccessToken();

  const calRes = await fetch(
    'https://www.googleapis.com/calendar/v3/calendars/primary/events',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        summary,
        location: location || undefined,
        start: { dateTime: new Date(start).toISOString() },
        end: { dateTime: new Date(end).toISOString() },
        extendedProperties:
          typeof customColor === 'string' && customColor.trim().length > 0
            ? {
                private: {
                  customColor: customColor.trim(),
                },
              }
            : undefined,
      }),
    }
  );

  if (!calRes.ok) {
    const errText = await calRes.text();
    return NextResponse.json(
      { error: 'Failed to create event', detail: errText },
      { status: 500 }
    );
  }

  const created = await calRes.json();
  return NextResponse.json({ status: 'success', event: created });
}
