import { NextResponse } from "next/server";

type CalendarEvent = {
  summary: string;
  start: string | null;
  end: string | null;
  location: string | null;
};

function unfoldLines(raw: string) {
  return raw.replace(/\r?\n[ \t]/g, "");
}

function parseIcsDate(value: string) {
  const match = value.match(/^(\d{8})T(\d{6})(Z)?$/);
  if (!match) return value;

  const [, d, t, z] = match;
  return `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}T${t.slice(0, 2)}:${t.slice(2, 4)}:${t.slice(4, 6)}${z ? "Z" : ""}`;
}

function parseEvents(raw: string): CalendarEvent[] {
  const lines = unfoldLines(raw).split(/\r?\n/);
  const events: CalendarEvent[] = [];
  let current: CalendarEvent | null = null;

  for (const line of lines) {
    if (line === "BEGIN:VEVENT") {
      current = { summary: "", start: null, end: null, location: null };
      continue;
    }

    if (line === "END:VEVENT") {
      if (current?.summary) events.push(current);
      current = null;
      continue;
    }

    if (!current) continue;

    if (line.startsWith("SUMMARY:")) current.summary = line.slice(8).trim();
    else if (line.startsWith("LOCATION:")) current.location = line.slice(9).trim() || null;
    else if (line.startsWith("DTSTART")) current.start = parseIcsDate(line.split(":").pop() ?? "");
    else if (line.startsWith("DTEND")) current.end = parseIcsDate(line.split(":").pop() ?? "");
  }

  return events;
}

export async function GET() {
  const url = process.env.OUTLOOK_ICS_URL;

  if (!url) {
    return NextResponse.json({ error: "Missing OUTLOOK_ICS_URL in .env.local" }, { status: 500 });
  }

  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) {
    return NextResponse.json(
      { error: "Failed to fetch ICS feed", status: res.status },
      { status: 502 }
    );
  }

  const raw = await res.text();
  const events = parseEvents(raw);
  const cleanedEvents = events.map((e: any) => ({
    ...e,
    summary: e.summary?.replace(/\\,/g, ',').replace(/\\;/g, ';').replace(/\\\\/g, '\\'),
    location: e.location?.replace(/\\,/g, ',').replace(/\\;/g, ';').replace(/\\\\/g, '\\') ?? null,
  }));

  return NextResponse.json({
    status: "success",
    count: events.length,
    cleanedEvents,
  });
}
