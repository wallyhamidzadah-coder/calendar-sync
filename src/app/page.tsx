'use client';

import { useEffect, useState } from 'react';
import { Calendar, dateFnsLocalizer, SlotInfo, Views, type View } from 'react-big-calendar';
import withDragAndDrop, {
  type EventInteractionArgs,
} from 'react-big-calendar/lib/addons/dragAndDrop';
import { format, parse, startOfWeek, getDay } from 'date-fns';
import 'react-big-calendar/lib/css/react-big-calendar.css';
import 'react-big-calendar/lib/addons/dragAndDrop/styles.css';
import './calendar-overrides.css';

const locales = {};
const localizer = dateFnsLocalizer({
  format,
  parse,
  startOfWeek,
  getDay,
  locales,
});
const DragAndDropCalendar = withDragAndDrop<CalendarEvent, object>(Calendar);

const OUTLOOK_COLOR = '#d83b01';
const GOOGLE_COLOR = '#1a73e8';
const EVENT_PURPLE = '#8b5cf6';
const EVENT_GOOGLE_BLUE = '#1a73e8';
const EVENT_OUTLOOK_GREEN = '#0e7c3f';
const COLOR_SWATCHES = ['#8b5cf6', '#1a73e8', '#0e7c3f', '#dc2626', '#f97316', '#eab308'] as const;
const MY_EMAIL = 'wally.hamidzadah.2027@marshall.usc.edu';
const SYNC_INTERVAL_MS = 10 * 60 * 1000;

type CalendarEvent = {
  id?: string;
  title: string;
  start: Date;
  end: Date;
  location: string | null;
  description?: string | null;
  attendees?: string[] | null;
  hasOtherAttendees?: boolean;
  customColor?: string | null;
  source: 'Outlook' | 'Google';
};

function hasMeetingLink(event: CalendarEvent): string | null {
  const text = `${event.location ?? ''}\n${event.description ?? ''}`.trim();
  if (!text) return null;

  const urlMatches = text.match(/https:\/\/[^\s)>'"]+/gi) || [];
  for (const rawUrl of urlMatches) {
    const url = rawUrl.replace(/[),.;]+$/g, '').trim();

    try {
      const parsed = new URL(url);
      const host = parsed.hostname.toLowerCase();

      if (
        host === 'zoom.us' ||
        host.endsWith('.zoom.us') ||
        host === 'teams.microsoft.com' ||
        host.endsWith('.teams.microsoft.com') ||
        host === 'meet.google.com' ||
        host.endsWith('.meet.google.com')
      ) {
        return url;
      }
    } catch {
      // Ignore malformed URLs and continue scanning.
    }

    if (url.toLowerCase().startsWith('https://')) {
      return url;
    }
  }

  return null;
}

function hasOtherAttendees(event: CalendarEvent) {
  if (typeof event.hasOtherAttendees === 'boolean') {
    return event.hasOtherAttendees;
  }

  const attendees = event.attendees ?? [];
  const me = MY_EMAIL.toLowerCase();
  return attendees.some((email) => {
    const normalized = (email || '').trim().toLowerCase();
    return normalized.length > 0 && normalized !== me;
  });
}

function toLocalInputValue(date: Date) {
  const offset = date.getTimezoneOffset();
  const local = new Date(date.getTime() - offset * 60000);
  return local.toISOString().slice(0, 16);
}

function formatRelativeSync(isoTimestamp: string | null, now: Date) {
  if (!isoTimestamp) return 'syncing...';

  const diffMs = now.getTime() - new Date(isoTimestamp).getTime();
  if (diffMs < 0) return 'just synced';

  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr${hours === 1 ? '' : 's'} ago`;

  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
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
  const [createCustomColor, setCreateCustomColor] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showOutlook, setShowOutlook] = useState(true);
  const [showGoogle, setShowGoogle] = useState(true);
  const [outlookCount, setOutlookCount] = useState(0);
  const [googleCount, setGoogleCount] = useState(0);
  const [outlookSyncedAt, setOutlookSyncedAt] = useState<string | null>(null);
  const [relativeNow, setRelativeNow] = useState(new Date());
  const [view, setView] = useState<View>(Views.WORK_WEEK);
  const [date, setDate] = useState(new Date());

  function loadEvents(options?: { background?: boolean }) {
    const isBackgroundSync = options?.background === true;
    if (!isBackgroundSync) {
      setLoading(true);
    }

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
                    description: e.description ?? null,
                    attendees: Array.isArray(e.attendees) ? e.attendees : null,
                    hasOtherAttendees:
                      typeof e.hasOtherAttendees === 'boolean' ? e.hasOtherAttendees : undefined,
                    customColor: typeof e.customColor === 'string' ? e.customColor : null,
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
                    description: e.description ?? null,
                    attendees: Array.isArray(e.attendees) ? e.attendees : null,
                    hasOtherAttendees:
                      typeof e.hasOtherAttendees === 'boolean' ? e.hasOtherAttendees : undefined,
                    customColor: typeof e.customColor === 'string' ? e.customColor : null,
                    source: 'Google' as const,
                  };
                })
                .filter((e): e is CalendarEvent => e !== null)
            : [];

        if (outlookData.status !== 'success') setError((p) => p || outlookData.error);
        if (googleData.status !== 'success') setError((p) => p || googleData.error);

        setOutlookCount(outlookEvents.length);
        setGoogleCount(googleEvents.length);
        setOutlookSyncedAt(typeof outlookData?.syncedAt === 'string' ? outlookData.syncedAt : null);
        setEvents([...outlookEvents, ...googleEvents]);
        if (!isBackgroundSync) {
          setLoading(false);
        }
      })
      .catch((err) => {
        setError(err.message);
        if (!isBackgroundSync) {
          setLoading(false);
        }
      });
  }

  useEffect(() => {
    loadEvents();
  }, []);

  useEffect(() => {
    const interval = window.setInterval(() => {
      loadEvents({ background: true });
    }, SYNC_INTERVAL_MS);

    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    const interval = window.setInterval(() => setRelativeNow(new Date()), 30000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const activeTag = document.activeElement?.tagName;
      if (activeTag === 'INPUT' || activeTag === 'TEXTAREA') {
        return;
      }

      const key = e.key.toLowerCase();
      if (key === 'm') {
        setView(Views.MONTH);
      } else if (key === 'w') {
        setView(Views.WORK_WEEK);
      } else if (key === 'd') {
        setView(Views.DAY);
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
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
    setCreateCustomColor(null);
    setCreating(true);
  }

  async function handleSave() {
    setSaving(true);
    try {
      if (creating) {
        const res = await fetch('/api/google/create', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...formData,
            customColor: createCustomColor || undefined,
          }),
        });
        const data = await res.json();
        if (data.status !== 'success') throw new Error(data.error || 'Create failed');
      } else if (editing && selectedEvent?.id) {
        const res = await fetch('/api/google/update', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: selectedEvent.id,
            ...formData,
            customColor: selectedEvent.customColor || undefined,
          }),
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

  async function persistEventTimeChange(event: CalendarEvent, start: Date, end: Date) {
    const res = await fetch('/api/google/update', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: event.id,
        summary: event.title,
        start,
        end,
        location: event.location || '',
        customColor: event.customColor || undefined,
      }),
    });

    const data = await res.json();
    if (data.status !== 'success') {
      throw new Error(data.error || 'Update failed');
    }
  }

  async function handleEventTimeChange({
    event,
    start,
    end,
  }: EventInteractionArgs<CalendarEvent>) {
    if (event.source !== 'Google' || !event.id) {
      return;
    }

    const nextStart = new Date(start);
    const nextEnd = new Date(end);
    const previousStart = event.start;
    const previousEnd = event.end;

    setEvents((prev) =>
      prev.map((e) =>
        e.source === 'Google' && e.id === event.id
          ? { ...e, start: nextStart, end: nextEnd }
          : e
      )
    );

    try {
      await persistEventTimeChange(event, nextStart, nextEnd);
    } catch (err: any) {
      setEvents((prev) =>
        prev.map((e) =>
          e.source === 'Google' && e.id === event.id
            ? { ...e, start: previousStart, end: previousEnd }
            : e
        )
      );
      setError(err.message || 'Failed to reschedule event');
    }
  }

  function handleEventDrop(args: EventInteractionArgs<CalendarEvent>) {
    void handleEventTimeChange(args);
  }

  function handleEventResize(args: EventInteractionArgs<CalendarEvent>) {
    void handleEventTimeChange(args);
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

  const selectedEventMeetingLink = selectedEvent ? hasMeetingLink(selectedEvent) : null;
  const isDnDView = view === Views.WORK_WEEK || view === Views.DAY;

  return (
    <main
      style={{
        width: '100%',
        maxWidth: 2000,
        margin: '0 auto',
        padding: 'clamp(24px, 2vw, 32px)',
        boxSizing: 'border-box',
        fontFamily: 'sans-serif',
      }}
    >
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
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
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
            <button
              type="button"
              onClick={() => loadEvents()}
              title="Refresh Outlook feed"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 30,
                height: 30,
                borderRadius: 15,
                border: '1px solid #3a3a3a',
                background: '#1a1a1a',
                color: '#d5d5d5',
                cursor: 'pointer',
                fontSize: 13,
              }}
            >
              ↻
            </button>
            <span style={{ fontSize: 12, color: '#999' }}>
              synced {formatRelativeSync(outlookSyncedAt, relativeNow)}
            </span>
          </div>
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
        <DragAndDropCalendar
          localizer={localizer}
          events={filteredEvents}
          startAccessor="start"
          endAccessor="end"
          view={view}
          onView={setView}
          date={date}
          onNavigate={setDate}
          views={[Views.MONTH, Views.WORK_WEEK, Views.DAY, Views.AGENDA]}
          messages={{ work_week: 'Week' }}
          selectable
          resizable
          draggableAccessor={(event: CalendarEvent) =>
            isDnDView && event.source === 'Google'
          }
          resizableAccessor={(event: CalendarEvent) =>
            isDnDView && event.source === 'Google'
          }
          onEventDrop={handleEventDrop}
          onEventResize={handleEventResize}
          eventPropGetter={(event: CalendarEvent) => ({
            style: {
              backgroundColor:
                event.customColor
                  ? event.customColor
                  : hasMeetingLink(event) || hasOtherAttendees(event)
                  ? EVENT_PURPLE
                  : event.source === 'Google'
                    ? EVENT_GOOGLE_BLUE
                    : EVENT_OUTLOOK_GREEN,
              border: 'none',
              cursor:
                isDnDView && event.source === 'Outlook'
                  ? 'not-allowed'
                  : isDnDView && event.source === 'Google'
                    ? 'grab'
                    : undefined,
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
                {creating && (
                  <>
                    <label style={labelStyle}>Color (optional)</label>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                      <button
                        type="button"
                        onClick={() => setCreateCustomColor(null)}
                        style={{
                          padding: '4px 10px',
                          background: createCustomColor ? '#2a2a2a' : '#1f2937',
                          border: createCustomColor ? '1px solid #3a3a3a' : '1px solid #60a5fa',
                          color: '#d1d5db',
                          borderRadius: 12,
                          fontSize: 11,
                          cursor: 'pointer',
                        }}
                        title="Use automatic color rules"
                      >
                        Auto
                      </button>
                      {COLOR_SWATCHES.map((color) => {
                        const selected = createCustomColor === color;
                        return (
                          <button
                            key={color}
                            type="button"
                            onClick={() => setCreateCustomColor(color)}
                            title={color}
                            aria-label={'Pick color ' + color}
                            style={{
                              width: 18,
                              height: 18,
                              borderRadius: '50%',
                              border: selected ? '2px solid #f5f5f5' : '1px solid #3a3a3a',
                              outline: selected ? '1px solid #111' : 'none',
                              background: color,
                              cursor: 'pointer',
                              padding: 0,
                            }}
                          />
                        );
                      })}
                    </div>
                  </>
                )}
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
                    {selectedEventMeetingLink && (
                      <button
                        style={buttonPrimary}
                        onClick={() => window.open(selectedEventMeetingLink, '_blank')}
                      >
                        Join
                      </button>
                    )}
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
