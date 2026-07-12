'use client';

import { useEffect, useState } from 'react';

type CalendarEvent = {
  summary: string;
  start: string;
  end: string;
  location: string | null;
  source: 'Outlook' | 'Google';
};

export default function Home() {
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      fetch('/api/outlook').then((res) => res.json()),
      fetch('/api/google/events').then((res) => res.json()),
    ])
      .then(([outlookData, googleData]) => {
        const outlookEvents: CalendarEvent[] =
          outlookData.status === 'success'
            ? outlookData.cleanedEvents.map((e: any) => ({ ...e, source: 'Outlook' }))
            : [];

        const googleEvents: CalendarEvent[] =
          googleData.status === 'success'
            ? googleData.events.map((e: any) => ({ ...e, source: 'Google' }))
            : [];

        if (outlookData.status !== 'success') {
          setError((prev) => prev || outlookData.error);
        }
        if (googleData.status !== 'success') {
          setError((prev) => prev || googleData.error);
        }

        setEvents([...outlookEvents, ...googleEvents]);
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message);
        setLoading(false);
      });
  }, []);

  const now = new Date();
  const upcoming = events
    .filter((e) => new Date(e.start) >= now)
    .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime())
    .slice(0, 30);

  if (loading) return <main style={{ padding: 40 }}>Loading events...</main>;

  return (
    <main style={{ padding: 40, fontFamily: 'sans-serif', maxWidth: 700 }}>
      <h1 style={{ fontSize: 24, marginBottom: 20 }}>Upcoming Events</h1>
      {error && (
        <div style={{ color: '#c00', marginBottom: 20 }}>
          Warning: {error}
        </div>
      )}
      {upcoming.map((e, i) => (
        <div
          key={i}
          style={{
            padding: '12px 0',
            borderBottom: '1px solid #ddd',
          }}
        >
          <div style={{ fontWeight: 600 }}>
            {e.summary}{' '}
            <span
              style={{
                fontSize: 11,
                fontWeight: 400,
                color: e.source === 'Outlook' ? '#0072c6' : '#1a73e8',
                border: '1px solid currentColor',
                borderRadius: 4,
                padding: '1px 6px',
                marginLeft: 6,
              }}
            >
              {e.source}
            </span>
          </div>
          <div style={{ fontSize: 14, color: '#555' }}>
            {new Date(e.start).toLocaleString()} to{' '}
            {new Date(e.end).toLocaleString()}
          </div>
          {e.location && (
            <div style={{ fontSize: 13, color: '#888' }}>{e.location}</div>
          )}
        </div>
      ))}
    </main>
  );
}