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

export async function DELETE(req: Request) {
  const tokenPath = path.join(process.cwd(), '.tokens.json');

  if (!fs.existsSync(tokenPath)) {
    return NextResponse.json(
      { error: 'No tokens found. Visit /api/google/login first.' },
      { status: 401 }
    );
  }

  const url = new URL(req.url);
  const id = url.searchParams.get('id');

  if (!id) {
    return NextResponse.json({ error: 'Missing event id' }, { status: 400 });
  }

  const accessToken = await getFreshAccessToken();

  const calRes = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/primary/events/${id}`,
    {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${accessToken}` },
    }
  );

  if (!calRes.ok && calRes.status !== 410) {
    const errText = await calRes.text();
    return NextResponse.json(
      { error: 'Failed to delete event', detail: errText },
      { status: 500 }
    );
  }

  return NextResponse.json({ status: 'success' });
}
