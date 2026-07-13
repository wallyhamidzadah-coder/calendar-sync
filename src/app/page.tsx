'use client';

import { useEffect, useState } from 'react';
import { Calendar, dateFnsLocalizer, SlotInfo } from 'react-big-calendar';
import { format, parse, startOfWeek, getDay } from 'date-fns';
import 'react-big-calendar/lib/css/react-big-calendar.css';
import './calendar-overrides.css';

const locales = {};
const localizer = dateFnsLocalizer({
  format,
  parse,
  startOfWeek,
  getDay,
  locales,
});

const OUTLOOK_COLOR = '#d83b01';
const GOOGLE_COLOR = '#1a73e8';

type CalendarEvent = {
  id?: string;
  title: string;
  start: Date;
  end: Date;
  location: string | null;
  source: 'Outlook' | 'Google';
};

function toLocalInputValue(date: Date) {
  const offset = date.getTimezoneOffset();
  const local = new Date(date.getTime() - offset * 60000);
  return local.toISOString().slice(0, 16);
}

export default function Home() {
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [editing, setEditing] = useState(false);
  const [formData, setFormData] = useState({
    summary: '',
    start: '',
    end: '',
    location: '',
  });
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showOutlook, setShowOutlook] = useState(true);
  const [showGoogle, setShowGoogle] = useState(true);
  const [outlookCount, setOutlookCount] = useState(0);
  const [googleCount, setGoogleCount] = useState(0);
  const [view, setView] = useState<'month' | 'week' | 'day' | 'agenda'>('week');
  const [date, setDate] = useState(new Date());

  function loadEvents() {
    setLoading(true);
    Promise.all([
      fetch('/api/outlook').then((res) => res.json()),
      fetch('/api/google/events').then((res) => res.json()),
    ])
      .then(([outlookData, googleData]) => {
        const outlookEvents =
          outlookData.status === 'success'
            ? outlookData.cleanedEvents
                .map((e: any) => {
                  const start = e.start ? new Date(e.start) : null;
                  const end = e.end ? new Date(e.end) : null;
                  
                  // Skip events with invalid dates
                  if (!start || !end || isNaN(start.getTime()) || isNaN(end.getTime())) {
                    return null;
                  }
                  
                  return {
                    title: e.summary,
                    start,
                    end,
                    location: e.location,
                    source: 'Outlook' as const,
                  };
                })
                .filter((e): e is CalendarEvent => e !== null)
            : [];

        const googleEvents =
          googleData.status === 'success'
            ? googleData.events
                .map((e: any) => {
                  const start = e.start ? new Date(e.start) : null;
                  const end = e.end ? new Date(e.end) : null;
                  
                  // Skip events with invalid dates
                  if (!start || !end || isNaN(start.getTime()) || isNaN(end.getTime())) {
                    return null;
                  }
                  
                  return {
                    id: e.id,
                    title: e.summary,
                    start,
                    end,
                    location: e.location,
                    source: 'Google' as const,
                  };
                })
                .filter((e): e is CalendarEvent => e !== null)
            : [];

        if (outlookData.status !== 'success') setError((p) => p || outlookData.error);
        if (googleData.status !== 'success') setError((p) => p || googleData.error);

        setOutlookCount(outlookEvents.length);
        setGoogleCount(googleEvents.length);
        setEvents([...outlookEvents, ...googleEvents]);
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message);
        setLoading(false);
      });
  }

  useEffect(() => {
    loadEvents();
  }, []);

  if (loading) return <main style={{ padding: 40 }}>Loading events...</main>;

  const filteredEvents = events.filter((e) => {
    if (e.source === 'Outlook' && !showOutlook) return false;
    if (e.source === 'Google' && !showGoogle) return false;
    if (e.title.trim().toLowerCase() === 'home') return false;
    if (searchTerm) {
      const t = searchTerm.toLowerCase();
      return (
        e.title.toLowerCase().includes(t) ||
        (e.location && e.location.toLowerCase().includes(t))
      );
    }
    return true;
  });

  function openEditForm(event: CalendarEvent) {
    setFormData({
      summary: event.title,
      start: toLocalInputValue(event.start),
      end: toLocalInputValue(event.end),
      location: event.location || '',
    });
    setEditing(true);
  }

  function openCreateForm(slotStart?: Date, slotEnd?: Date) {
    const start = slotStart || new Date();
    const end = slotEnd || new Date(start.getTime() + 30 * 60000);
    setFormData({
      summary: '',
      start: toLocalInputValue(start),
      end: toLocalInputValue(end),
      location: '',
    });
    setSelectedEvent(null);
    setCreating(true);
  }

  async function handleSave() {
    setSaving(true);
    try {
      if (creating) {
        const res = await fetch('/api/google/create', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(formData),
        });
        const data = await res.json();
        if (data.status !== 'success') throw new Error(data.error || 'Create failed');
      } else if (editing && selectedEvent?.id) {
        const res = await fetch('/api/google/update', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: selectedEvent.id, ...formData }),
        });
        const data = await res.json();
        if (data.status !== 'success') throw new Error(data.error || 'Update failed');
      }
      setCreating(false);
      setEditing(false);
      setSelectedEvent(null);
      loadEvents();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!selectedEvent?.id) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/google/delete?id=${selectedEvent.id}`, {
        method: 'DELETE',
      });
      const data = await res.json();
      if (data.status !== 'success') throw new Error(data.error || 'Delete failed');
      setSelectedEvent(null);
      loadEvents();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: '8px 10px',
    background: '#151515',
    border: '1px solid #333',
    borderRadius: 6,
    color: '#e5e5e5',
    fontSize: 14,
    marginBottom: 12,
  };

  const labelStyle: React.CSSProperties = {
    fontSize: 12,
    color: '#999',
    marginBottom: 4,
    display: 'block',
  };

  const buttonPrimary: React.CSSProperties = {
    padding: '8px 16px',
    background: '#1a73e8',
    border: 'none',
    color: '#fff',
    borderRadius: 6,
    cursor: 'pointer',
    fontSize: 14,
    marginRight: 8,
  };

  const buttonSecondary: React.CSSProperties = {
    padding: '8px 16px',
    background: '#2a2a2a',
    border: '1px solid #3a3a3a',
    color: '#e5e5e5',
    borderRadius: 6,
    cursor: 'pointer',
    fontSize: 14,
    marginRight: 8,
  };

  const buttonDanger: React.CSSProperties = {
    padding: '8px 16px',
    background: '#3a1a1a',
    border: '1px solid #5a2a2a',
    color: '#ff8a8a',
    borderRadius: 6,
    cursor: 'pointer',
    fontSize: 14,
  };

  const toggleChip = (active: boolean, color: string): React.CSSProperties => ({
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    padding: '6px 12px',
    borderRadius: 20,
    border: `1px solid ${active ? color : '#333'}`,
    background: active ? `${color}22` : '#1a1a1a',
    color: active ? '#fff' : '#777',
    cursor: 'pointer',
    fontSize: 13,
  });

  return (
    <main style={{ padding: 20, fontFamily: 'sans-serif' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 12,
          flexWrap: 'wrap',
          gap: 10,
        }}
      >
        <h1 style={{ fontSize: 22 }}>Calendar</h1>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <button
            style={toggleChip(showOutlook, OUTLOOK_COLOR)}
            onClick={() => setShowOutlook((v) => !v)}
          >
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                background: OUTLOOK_COLOR,
                display: 'inline-block',
              }}
            />
            Outlook ({outlookCount})
          </button>
          <button
            style={toggleChip(showGoogle, GOOGLE_COLOR)}
            onClick={() => setShowGoogle((v) => !v)}
          >
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                background: GOOGLE_COLOR,
                display: 'inline-block',
              }}
            />
            Google ({googleCount})
          </button>
          <input
            type="text"
            placeholder="Search events..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            style={{
              padding: '8px 12px',
              background: '#1f1f1f',
              border: '1px solid #333',
              borderRadius: 6,
              color: '#e5e5e5',
              width: 200,
              fontSize: 14,
            }}
          />
          <button style={buttonPrimary} onClick={() => openCreateForm()}>
            + New Event
          </button>
        </div>
      </div>

      {error && (
        <div style={{ color: '#c00', marginBottom: 12 }}>
          Warning: {error}{' '}
          <button
            onClick={() => setError(null)}
            style={{ background: 'none', border: 'none', color: '#c00', cursor: 'pointer' }}
          >
            dismiss
          </button>
        </div>
      )}

      {searchTerm && (
        <div style={{ color: '#888', fontSize: 13, marginBottom: 8 }}>
          {filteredEvents.length} match{filteredEvents.length === 1 ? '' : 'es'} for &quot;{searchTerm}&quot;
        </div>
      )}

      <div style={{ height: '85vh' }}>
        <Calendar
          localizer={localizer}
          events={filteredEvents}
          startAccessor="start"
          endAccessor="end"
          view={view}
          onView={setView}
          date={date}
          onNavigate={setDate}
          views={['month', 'week', 'day', 'agenda']}
          selectable
          eventPropGetter={(event: CalendarEvent) => ({
            style: {
              backgroundColor: event.source === 'Outlook' ? OUTLOOK_COLOR : GOOGLE_COLOR,
              border: 'none',
            },
          })}
          onSelectEvent={(event: CalendarEvent) => setSelectedEvent(event)}
          onSelectSlot={(slot: SlotInfo) => openCreateForm(slot.start, slot.end)}
        />
      </div>

      {(selectedEvent || creating) && (
        <div
          onClick={() => {
            setSelectedEvent(null);
            setEditing(false);
            setCreating(false);
          }}
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(0,0,0,0.6)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: '#1f1f1f',
              color: '#e5e5e5',
              padding: 24,
              borderRadius: 8,
              maxWidth: 420,
              width: '90%',
              border: '1px solid #333',
            }}
          >
            {creating || editing ? (
              <>
                <h2 style={{ fontSize: 16, marginBottom: 16 }}>
                  {creating ? 'New Google Event' : 'Edit Google Event'}
                </h2>
                <label style={labelStyle}>Title</label>
                <input
                  style={inputStyle}
                  value={formData.summary}
                  onChange={(e) => setFormData({ ...formData, summary: e.target.value })}
                />
                <label style={labelStyle}>Start</label>
                <input
                  type="datetime-local"
                  style={inputStyle}
                  value={formData.start}
                  onChange={(e) => setFormData({ ...formData, start: e.target.value })}
                />
                <label style={labelStyle}>End</label>
                <input
                  type="datetime-local"
                  style={inputStyle}
                  value={formData.end}
                  onChange={(e) => setFormData({ ...formData, end: e.target.value })}
                />
                <label style={labelStyle}>Location (optional)</label>
                <input
                  style={inputStyle}
                  value={formData.location}
                  onChange={(e) => setFormData({ ...formData, location: e.target.value })}
                />
                <div style={{ marginTop: 8 }}>
                  <button style={buttonPrimary} onClick={handleSave} disabled={saving}>
                    {saving ? 'Saving...' : 'Save'}
                  </button>
                  <button
                    style={buttonSecondary}
                    onClick={() => {
                      setEditing(false);
                      setCreating(false);
                      setSelectedEvent(null);
                    }}
                  >
                    Cancel
                  </button>
                </div>
              </>
            ) : (
              selectedEvent && (
                <>
                  <div
                    style={{
                      fontSize: 11,
                      color: selectedEvent.source === 'Outlook' ? OUTLOOK_COLOR : GOOGLE_COLOR,
                      marginBottom: 6,
                      fontWeight: 600,
                    }}
                  >
                    {selectedEvent.source}
                  </div>
                  <h2 style={{ fontSize: 18, marginBottom: 12 }}>{selectedEvent.title}</h2>
                  <div style={{ fontSize: 14, color: '#aaa', marginBottom: 6 }}>
                    {selectedEvent.start.toLocaleString()} to {selectedEvent.end.toLocaleString()}
                  </div>
                  {selectedEvent.location && (
                    <div style={{ fontSize: 14, color: '#aaa', marginBottom: 12 }}>
                      {selectedEvent.location}
                    </div>
                  )}
                  {selectedEvent.source === 'Outlook' && (
                    <div style={{ fontSize: 12, color: '#666', marginBottom: 12 }}>
                      Outlook events are view-only.
                    </div>
                  )}
                  <div style={{ marginTop: 12 }}>
                    {selectedEvent.source === 'Google' && (
                      <>
                        <button style={buttonPrimary} onClick={() => openEditForm(selectedEvent)}>
                          Edit
                        </button>
                        <button style={buttonDanger} onClick={handleDelete} disabled={saving}>
                          {saving ? 'Deleting...' : 'Delete'}
                        </button>
                      </>
                    )}
                    <button style={buttonSecondary} onClick={() => setSelectedEvent(null)}>
                      Close
                    </button>
                  </div>
                </>
              )
            )}
          </div>
        </div>
      )}
    </main>
  );
}
