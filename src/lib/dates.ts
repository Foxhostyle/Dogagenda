import {
  addDays,
  differenceInCalendarDays,
  differenceInMonths,
  differenceInYears,
  format,
  isSameDay,
  parse,
  parseISO,
  startOfWeek,
} from 'date-fns'
import { fr } from 'date-fns/locale'

export type DateStr = string // YYYY-MM-DD
export type TimeStr = string // HH:mm

export function toDateStr(d: Date): DateStr {
  return format(d, 'yyyy-MM-dd')
}

export function fromDateStr(s: DateStr): Date {
  return parse(s, 'yyyy-MM-dd', new Date())
}

export function todayStr(now: Date = new Date()): DateStr {
  return toDateStr(now)
}

/** Lundi de la semaine contenant `d` (la semaine française commence le lundi). */
export function mondayOf(d: Date | DateStr): DateStr {
  const date = typeof d === 'string' ? fromDateStr(d) : d
  return toDateStr(startOfWeek(date, { weekStartsOn: 1 }))
}

export function addDaysStr(s: DateStr, n: number): DateStr {
  return toDateStr(addDays(fromDateStr(s), n))
}

/** Les 7 dates de la semaine commençant au lundi `monday`. */
export function weekDates(monday: DateStr): DateStr[] {
  return Array.from({ length: 7 }, (_, i) => addDaysStr(monday, i))
}

/** 0 = lundi … 6 = dimanche. */
export function weekdayIndex(s: DateStr): number {
  return (fromDateStr(s).getDay() + 6) % 7
}

/** Combine une date calendaire et une heure locale en Date. */
export function atTime(date: DateStr, time: TimeStr): Date {
  return parse(`${date} ${time}`, 'yyyy-MM-dd HH:mm', new Date())
}

export function parseIso(iso: string): Date {
  return parseISO(iso)
}

/** « jeudi 3 juillet » */
export function formatDayLong(s: DateStr): string {
  return format(fromDateStr(s), 'EEEE d MMMM', { locale: fr })
}

/** « jeu. 3 juil. » */
export function formatDayShort(s: DateStr): string {
  return format(fromDateStr(s), 'EEE d MMM', { locale: fr })
}

/** « 18h30 » (convention française). */
export function formatTime(time: TimeStr): string {
  const [h, m] = time.split(':')
  return m === '00' ? `${Number(h)}h` : `${Number(h)}h${m}`
}

/** « jeu. 3 juil. à 18h30 » */
export function formatInstant(iso: string, now: Date = new Date()): string {
  const d = parseISO(iso)
  const time = format(d, 'HH:mm')
  if (isSameDay(d, now)) return formatTime(time)
  return `${format(d, 'EEE d MMM', { locale: fr })} à ${formatTime(time)}`
}

/** « Semaine du 30 juin » */
export function weekLabel(monday: DateStr): string {
  return `Semaine du ${format(fromDateStr(monday), 'd MMMM', { locale: fr })}`
}

export function isToday(s: DateStr, now: Date = new Date()): boolean {
  return s === toDateStr(now)
}

export function relativeDayLabel(s: DateStr, now: Date = new Date()): string {
  const diff = differenceInCalendarDays(fromDateStr(s), now)
  if (diff === 0) return "Aujourd'hui"
  if (diff === 1) return 'Demain'
  if (diff === -1) return 'Hier'
  return formatDayLong(s)
}

/** Âge d'un animal : « 3 ans » ou « 7 mois ». */
export function ageLabel(birthDate: DateStr, now: Date = new Date()): string {
  const birth = fromDateStr(birthDate)
  const years = differenceInYears(now, birth)
  if (years >= 1) return `${years} an${years > 1 ? 's' : ''}`
  const months = Math.max(differenceInMonths(now, birth), 0)
  return months <= 1 ? `${months || 1} mois` : `${months} mois`
}
