/**
 * Génération du calendrier iCalendar (.ics) personnel d'un membre :
 * ses périodes de garde et ses promenades assignées. Utilisé pour le
 * téléchargement direct et par l'Edge Function de flux abonné.
 */
import type { AppSnapshot } from '../domain/types'
import { addDaysStr, atTime, parseIso, todayStr } from './dates'

/** Instant au format iCalendar UTC : `yyyyMMdd'T'HHmmss'Z'`. */
export function formatIcsDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return (
    `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}` +
    `T${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`
  )
}

/** Échappe le texte selon RFC 5545 (virgules, points-virgules, retours). */
function escapeIcsText(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n')
}

/**
 * Calendrier complet d'un membre : un VEVENT par période de garde, et un
 * VEVENT par promenade assignée entre J−7 et J+60 (créneaux actifs
 * uniquement). Lignes terminées par CRLF comme l'exige la RFC 5545.
 */
export function buildMemberIcs(snap: AppSnapshot, memberId: string, now: Date = new Date()): string {
  const stamp = formatIcsDate(now)
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Dogagenda//Dogagenda//FR',
    'CALSCALE:GREGORIAN',
    'X-WR-CALNAME:Dogagenda',
  ]

  const pushEvent = (id: string, start: Date, end: Date, summary: string) => {
    lines.push(
      'BEGIN:VEVENT',
      `UID:${id}@dogagenda`,
      `DTSTAMP:${stamp}`,
      `DTSTART:${formatIcsDate(start)}`,
      `DTEND:${formatIcsDate(end)}`,
      `SUMMARY:${escapeIcsText(summary)}`,
      'END:VEVENT',
    )
  }

  // Périodes de garde du membre.
  for (const period of snap.carePeriods) {
    if (period.memberId !== memberId) continue
    pushEvent(period.id, parseIso(period.startAt), parseIso(period.endAt), `🐕 Garde de ${snap.pet.name}`)
  }

  // Promenades assignées, de J−7 à J+60.
  const today = todayStr(now)
  const from = addDaysStr(today, -7)
  const to = addDaysStr(today, 60)
  for (const slot of snap.walkSlots) {
    if (slot.assignedMemberId !== memberId) continue
    if (slot.date < from || slot.date > to) continue
    const template = snap.slotTemplates.find((t) => t.id === slot.slotTemplateId)
    if (!template || !template.active) continue
    pushEvent(
      slot.id,
      atTime(slot.date, template.startTime),
      atTime(slot.date, template.endTime),
      `🐾 Promenade ${template.name} – ${snap.pet.name}`,
    )
  }

  lines.push('END:VCALENDAR')
  return lines.join('\r\n') + '\r\n'
}
