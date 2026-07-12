import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

export async function GET(req: Request) {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI;

  if (!clientId || !clientSecret || !redirectUri) {
    return NextResponse.json(
      { error: 'Missing Google env vars in .env.local' },
      { status: 500 }
    );
  }

  const url = new URL(req.url);
  const code = url.searchParams.get('code');

  if (!code) {
    return NextResponse.json(
      { error: 'No code returned from Google' },
      { status: 400 }
    );
  }

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
  });

  if (!tokenRes.ok) {
    const errText = await tokenRes.text();
    return NextResponse.json(
      { error: 'Token exchange failed', detail: errText },
      { status: 500 }
    );
  }

  const tokens = await tokenRes.json();

  const tokenPath = path.join(process.cwd(), '.tokens.json');
  fs.writeFileSync(tokenPath, JSON.stringify(tokens, null, 2));

  return NextResponse.redirect(new URL('/', req.url));
}