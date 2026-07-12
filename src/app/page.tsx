'use client';

import { useEffect, useState } from 'react';

type CalendarEvent = {
  summary: string;
  start: string;
  end: string;
  location: string | null;
};

export default function Home() {
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/outlook')
      .then((res) => res.json())
      .then((data) => {
        if (data.status === 'success') {
          setEvents(data.cleanedEvents);
        } else {
          setError(data.error || 'Unknown error');
        }
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
    .slice(0, 20);

  if (loading) return <main style={{ padding: 40 }}>Loading events...</main>;
  if (error) return <main style={{ padding: 40 }}>Error: {error}</main>;

  return (
    <main style={{ padding: 40, fontFamily: 'sans-serif', maxWidth: 700 }}>
      <h1 style={{ fontSize: 24, marginBottom: 20 }}>Upcoming Events</h1>
      {upcoming.map((e, i) => (
        <div
          key={i}
          style={{
            padding: '12px 0',
            borderBottom: '1px solid #ddd',
          }}
        >
          <div style={{ fontWeight: 600 }}>{e.summary}</div>
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