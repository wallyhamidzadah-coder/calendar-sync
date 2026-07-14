import { NextResponse } from "next/server";
import { RRule } from "rrule";

type CalendarEvent = {
  summary: string;
  start: string | null;
  end: string | null;
  location: string | null;
  description: string | null;
  attendees: string[];
  hasOtherAttendees: boolean;
};

const MY_EMAIL = "wally.hamidzadah.2027@marshall.usc.edu";
const WINDOWS_TZ_TO_IANA: Record<string, string> = {
  "Pacific Standard Time": "America/Los_Angeles",
  "Mountain Standard Time": "America/Denver",
  "Central Standard Time": "America/Chicago",
  "Eastern Standard Time": "America/New_York",
  "Singapore Standard Time": "Asia/Singapore",
  UTC: "UTC",
};

function extractTzid(line: string | null) {
  if (!line) return null;
  const match = line.match(/;TZID=([^:;]+)/i);
  return match?.[1]?.trim() || null;
}

function mapWindowsTzidToIana(tzid: string | null) {
  if (!tzid) return null;
  const normalized = tzid.trim();
  return WINDOWS_TZ_TO_IANA[normalized] || normalized;
}

function getTimeZoneOffsetMs(date: Date, timeZone: string) {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });

  const parts = dtf.formatToParts(date);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? "0");
  const asUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour"),
    get("minute"),
    get("second")
  );

  return asUtc - date.getTime();
}

function zonedLocalToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  timeZone: string
) {
  let utcGuess = Date.UTC(year, month - 1, day, hour, minute, second);
  for (let i = 0; i < 3; i++) {
    const offset = getTimeZoneOffsetMs(new Date(utcGuess), timeZone);
    const next = Date.UTC(year, month - 1, day, hour, minute, second) - offset;
    if (next === utcGuess) break;
    utcGuess = next;
  }
  return new Date(utcGuess);
}

function parseAttendeeEmail(line: string): string | null {
  const match = line.match(/mailto:([^;:\s]+)/i);
  return match?.[1]?.trim().toLowerCase() || null;
}

function computeHasOtherAttendees(attendees: string[]) {
  const me = MY_EMAIL.toLowerCase();
  return attendees.some((email) => {
    const normalized = (email || "").trim().toLowerCase();
    return normalized.length > 0 && normalized !== me;
  });
}

function unfoldLines(raw: string) {
  return raw.replace(/\r?\n[ \t]/g, "");
}

function parseIcsDateToDate(value: string, tzid?: string | null): Date | null {
  // Handle all-day events: YYYYMMDD
  const allDayMatch = value.match(/^(\d{8})$/);
  if (allDayMatch) {
    const d = allDayMatch[1];
    return new Date(`${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}T00:00:00Z`);
  }

  // Handle datetime with optional Z: YYYYMMDDTHHMMSS[Z]
  const dateTimeMatch = value.match(/^(\d{8})T(\d{6})(Z)?$/);
  if (dateTimeMatch) {
    const [, d, t, z] = dateTimeMatch;
    const year = Number(d.slice(0, 4));
    const month = Number(d.slice(4, 6));
    const day = Number(d.slice(6, 8));
    const hour = Number(t.slice(0, 2));
    const minute = Number(t.slice(2, 4));
    const second = Number(t.slice(4, 6));

    if (z) {
      return new Date(Date.UTC(year, month - 1, day, hour, minute, second));
    }

    const mappedTz = mapWindowsTzidToIana(tzid ?? null);
    if (mappedTz) {
      try {
        return zonedLocalToUtc(year, month, day, hour, minute, second, mappedTz);
      } catch {
        // Fall back below if timezone conversion fails.
      }
    }

    return new Date(
      `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}T${t.slice(0, 2)}:${t.slice(2, 4)}:${t.slice(4, 6)}`
    );
  }

  return null;
}

function parseIcsFloatingLocalDate(value: string): Date | null {
  const dateTimeMatch = value.match(/^(\d{8})T(\d{6})$/);
  if (!dateTimeMatch) return null;
  const [, d, t] = dateTimeMatch;
  return new Date(
    `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}T${t.slice(0, 2)}:${t.slice(2, 4)}:${t.slice(4, 6)}`
  );
}

function parseEvents(raw: string): CalendarEvent[] {
  const lines = unfoldLines(raw).split(/\r?\n/);
  const rawEvents: any[] = [];
  let current: any = null;
  
  // Debug: Track RRULE lines both inside and outside VEVENT
  let rruleInsideVevent = 0;
  let rruleOutsideVevent = 0;

  for (const line of lines) {
    if (line === "BEGIN:VEVENT") {
      current = {
        uid: null as string | null,
        summary: "",
        start: null,
        end: null,
        dtstartTzid: null as string | null,
        dtendTzid: null as string | null,
        location: null,
        description: null,
        attendees: [] as string[],
        rrule: null,
        dtstart: null,
        dtend: null,
        exdates: [] as string[],
        recurrenceId: null as string | null,
        status: "CONFIRMED",
      };
      continue;
    }

    if (line === "END:VEVENT") {
      if (current?.summary) rawEvents.push(current);
      current = null;
      continue;
    }

    // Track RRULE outside VEVENT
    if (line.startsWith("RRULE") && !current) {
      rruleOutsideVevent++;
      continue;
    }

    if (!current) continue;

    if (line.startsWith("UID:")) current.uid = line.slice(4).trim();
    else if (line.startsWith("SUMMARY:")) current.summary = line.slice(8).trim();
    else if (line.startsWith("LOCATION:")) current.location = line.slice(9).trim() || null;
    else if (line.startsWith("DESCRIPTION")) current.description = (line.split(":").pop() ?? "").trim() || null;
    else if (line.startsWith("STATUS:")) current.status = line.slice(7).trim();
    else if (line.startsWith("ATTENDEE")) {
      const attendeeEmail = parseAttendeeEmail(line);
      if (attendeeEmail) current.attendees.push(attendeeEmail);
    }
    else if (line.startsWith("DTSTART")) {
      const value = line.split(":").pop() ?? "";
      current.dtstartTzid = extractTzid(line);
      current.dtstart = value;
      const parsed = parseIcsDateToDate(value, current.dtstartTzid);
      current.start = parsed ? parsed.toISOString() : value;
    }
    else if (line.startsWith("DTEND")) {
      const value = line.split(":").pop() ?? "";
      current.dtendTzid = extractTzid(line);
      current.dtend = value;
      const parsed = parseIcsDateToDate(value, current.dtendTzid ?? current.dtstartTzid);
      current.end = parsed ? parsed.toISOString() : value;
    }
    else if (line.startsWith("RRULE")) {
      rruleInsideVevent++;
      // Match RRULE: or RRULE;... (with optional parameters)
      const colonIndex = line.indexOf(":");
      if (colonIndex > -1) {
        const rruleValue = line.slice(colonIndex + 1).trim();
        // Append to existing RRULE if present (some events may have multiple RRULE lines)
        if (current.rrule) {
          current.rrule += "\n" + rruleValue;
        } else {
          current.rrule = rruleValue;
        }
      }
    }
    else if (line.startsWith("EXDATE")) {
      const value = line.split(":").pop() ?? "";
      // EXDATE can have multiple comma-separated dates
      const exdates = value.split(",");
      current.exdates.push(...exdates);
    }
    else if (line.startsWith("RECURRENCE-ID")) {
      const value = line.split(":").pop() ?? "";
      current.recurrenceId = value;
    }
  }

  // Group events: recurring events + their RECURRENCE-ID overrides
  const recurringMap = new Map<string, any>();
  const recurrenceOverrides = new Map<string, any>();  // Key: "uid|YYYYMMDD" of RECURRENCE-ID
  const nonRecurringEvents: any[] = [];

  for (const event of rawEvents) {
    if (event.rrule) {
      // Base recurring event - use UID as key
      const key = event.uid || `${event.summary}|${event.dtstart}`;
      recurringMap.set(key, event);
    } else if (event.recurrenceId) {
      // Override for a specific occurrence - key by UID + recurrence-id date
      const recIdDate = event.recurrenceId.substring(0, 8); // Extract YYYYMMDD
      const key = `${event.uid}|${recIdDate}`;
      recurrenceOverrides.set(key, event);
      if (process.env.NODE_ENV !== 'production') {
        console.log(`[parseEvents] Found override: UID="${event.uid}", date=${recIdDate}, status=${event.status}`);
      }
    } else {
      // Non-recurring event
      nonRecurringEvents.push(event);
    }
  }

  console.log(
    `[parseEvents] Raw events parsed: ${rawEvents.length} | recurring: ${recurringMap.size} | non-recurring: ${nonRecurringEvents.length} | overrides: ${recurrenceOverrides.size}`
  );

  // Expand recurring events
  const expandedEvents: CalendarEvent[] = [];
  const now = new Date();
  const minDate = new Date(now);
  minDate.setDate(minDate.getDate() - 90); // 90 days in the past
  const maxDate = new Date(now);
  maxDate.setDate(maxDate.getDate() + 90); // 90 days in the future

  // Add non-recurring events
  for (const event of nonRecurringEvents) {
    const attendees = Array.isArray(event.attendees) ? event.attendees : [];
    expandedEvents.push({
      summary: event.summary,
      start: event.start,
      end: event.end,
      location: event.location,
      description: event.description ?? null,
      attendees,
      hasOtherAttendees: computeHasOtherAttendees(attendees),
    });
  }

  // Expand recurring events
  for (const event of recurringMap.values()) {
    try {
      const startDate = new Date(event.start);
      const endDate = new Date(event.end);

      if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
        continue;
      }

      const durationMs = endDate.getTime() - startDate.getTime();

      // Parse EXDATE exceptions into a Set for fast lookup
      const exdateSet = new Set<string>();
      for (const exdate of event.exdates) {
        const exdateDate = parseIcsDateToDate(exdate, event.dtstartTzid ?? event.dtendTzid);
        if (exdateDate) {
          exdateSet.add(exdateDate.toISOString().split("T")[0]);
        }
      }

      // Parse RRULE and generate occurrences
      const rruleOptions = RRule.parseString(event.rrule);
      const mappedRruleTzid = mapWindowsTzidToIana(event.dtstartTzid ?? event.dtendTzid);
      const rruleSeedDtstart =
        mappedRruleTzid && event.dtstart && !event.dtstart.endsWith("Z")
          ? parseIcsFloatingLocalDate(event.dtstart) ?? startDate
          : startDate;
      const rrule = new RRule({
        ...rruleOptions,
        ...(mappedRruleTzid ? { tzid: mappedRruleTzid } : {}),
        dtstart: rruleSeedDtstart,
      });

      const occurrences = rrule.between(minDate, maxDate, true);
      let skippedCount = 0;

      for (const occurrence of occurrences) {
        const occurrenceDateStr = occurrence.toISOString().split("T")[0]; // YYYY-MM-DD
        const occurrenceDateYyyymmdd = occurrenceDateStr.replace(/-/g, ""); // YYYYMMDD

        // Double-check that occurrence is strictly within 90-day window
        if (occurrence < minDate || occurrence > maxDate) {
          skippedCount++;
          continue;
        }

        // Skip if this occurrence is in EXDATE
        if (exdateSet.has(occurrenceDateStr)) {
          skippedCount++;
          if (process.env.NODE_ENV !== 'production') {
            console.log(`    Skipped by EXDATE: ${event.summary} on ${occurrenceDateStr}`);
          }
          continue;
        }

        // Check for RECURRENCE-ID override by UID + YYYYMMDD date
        const overrideKey = `${event.uid}|${occurrenceDateYyyymmdd}`;
        const useOverride = recurrenceOverrides.get(overrideKey);

        // If override exists and is CANCELLED, skip this occurrence
        if (useOverride && useOverride.status === "CANCELLED") {
          skippedCount++;
          if (process.env.NODE_ENV !== 'production') {
            console.log(`    Skipped by CANCELLED override: ${event.summary} on ${occurrenceDateStr}`);
          }
          continue;
        }

        // Skip future CONFIRMED overrides (they're orphaned from deleted series)
        if (useOverride && useOverride.status === "CONFIRMED") {
          const overrideDate = new Date(useOverride.start);
          if (overrideDate >= now) {
            skippedCount++;
            if (process.env.NODE_ENV !== 'production') {
              console.log(`    Skipped future CONFIRMED override: ${event.summary} on ${occurrenceDateStr}`);
            }
            continue;
          }
        }

        // If override exists and is not cancelled, use it (replaces the generated occurrence)
        if (useOverride) {
          const overrideAttendees =
            Array.isArray(useOverride.attendees) && useOverride.attendees.length > 0
              ? useOverride.attendees
              : Array.isArray(event.attendees)
                ? event.attendees
                : [];
          if (process.env.NODE_ENV !== 'production' && skippedCount === 0) {
            console.log(`    Using past override for ${event.summary} on ${occurrenceDateStr}: start=${useOverride.start}`);
          }
          expandedEvents.push({
            summary: useOverride.summary,
            start: useOverride.start,
            end: useOverride.end,
            location: useOverride.location,
            description: useOverride.description ?? event.description ?? null,
            attendees: overrideAttendees,
            hasOtherAttendees: computeHasOtherAttendees(overrideAttendees),
          });
        } else {
          // Use the generated occurrence
          const occurrenceEnd = new Date(occurrence.getTime() + durationMs);
          const attendees = Array.isArray(event.attendees) ? event.attendees : [];
          expandedEvents.push({
            summary: event.summary,
            start: occurrence.toISOString(),
            end: occurrenceEnd.toISOString(),
            location: event.location,
            description: event.description ?? null,
            attendees,
            hasOtherAttendees: computeHasOtherAttendees(attendees),
          });
        }
      }
      
      if (process.env.NODE_ENV !== 'production' && (skippedCount > 0 || occurrences.length > 50)) {
        console.log(`  "${event.summary}": ${occurrences.length} occurrences, ${skippedCount} skipped`);
      }
    } catch (err) {
      // If RRULE parsing fails, add the original event as a fallback
      expandedEvents.push({
        summary: event.summary,
        start: event.start,
        end: event.end,
        location: event.location,
        description: event.description ?? null,
        attendees: Array.isArray(event.attendees) ? event.attendees : [],
        hasOtherAttendees: computeHasOtherAttendees(Array.isArray(event.attendees) ? event.attendees : []),
      });
    }
  }

  console.log(`[parseEvents] Final total events after expansion: ${expandedEvents.length}`);
  return expandedEvents;
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
  const syncedAt = new Date().toISOString();
  
  // Debug: count all RRULE lines in raw ICS (with or without parameters)
  const lines = unfoldLines(raw).split(/\r?\n/);
  const rruleCount = lines.filter(l => l.startsWith("RRULE")).length;
  console.log(`[Outlook API] Raw RRULE lines found: ${rruleCount}`);
  console.log(`[Outlook API] Total events after parsing/expansion: ${events.length}`);
  
  const cleanedEvents = events.map((e: any) => ({
    ...e,
    summary: e.summary?.replace(/\\,/g, ',').replace(/\\;/g, ';').replace(/\\\\/g, '\\'),
    location: e.location?.replace(/\\,/g, ',').replace(/\\;/g, ';').replace(/\\\\/g, '\\') ?? null,
    description: e.description?.replace(/\\,/g, ',').replace(/\\;/g, ';').replace(/\\\\/g, '\\') ?? null,
  }));

  return NextResponse.json({
    status: "success",
    count: events.length,
    syncedAt,
    cleanedEvents,
  });
}
