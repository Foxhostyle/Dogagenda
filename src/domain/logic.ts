/**
 * Logique métier pure de Dogagenda — aucune dépendance UI ni réseau.
 * Couverte par les tests unitaires (tests/logic.test.ts).
 */
import { atTime, mondayOf, parseIso, weekDates, weekdayIndex, type DateStr } from '../lib/dates'
import type {
  CarePeriod,
  CascadeStep,
  Member,
  Message,
  PhotoRef,
  SlotTemplate,
  SwapRequest,
  WalkSlot,
  WeekTemplate,
} from './types'

// ---------------------------------------------------------------------------
// Créneaux de promenade
// ---------------------------------------------------------------------------

export function slotKey(date: DateStr, slotTemplateId: string): string {
  return `${date}|${slotTemplateId}`
}

export function findWalkSlot(
  slots: WalkSlot[],
  date: DateStr,
  slotTemplateId: string,
): WalkSlot | undefined {
  return slots.find((s) => s.date === date && s.slotTemplateId === slotTemplateId)
}

export type DerivedSlotStatus = 'done' | 'skipped' | 'upcoming' | 'current' | 'missed'

export interface DaySlotView {
  template: SlotTemplate
  slot?: WalkSlot
  status: DerivedSlotStatus
}

/**
 * Vue fusionnée des créneaux d'un jour : chaque template actif, avec la ligne
 * WalkSlot éventuelle et un statut dérivé du moment présent.
 */
export function daySlotViews(
  templates: SlotTemplate[],
  slots: WalkSlot[],
  date: DateStr,
  now: Date,
): DaySlotView[] {
  return activeTemplates(templates).map((template) => {
    const slot = findWalkSlot(slots, date, template.id)
    let status: DerivedSlotStatus
    if (slot?.status === 'done') status = 'done'
    else if (slot?.status === 'skipped') status = 'skipped'
    else if (now < atTime(date, template.startTime)) status = 'upcoming'
    else if (now <= atTime(date, template.endTime)) status = 'current'
    else status = 'missed'
    return { template, slot, status }
  })
}

export function activeTemplates(templates: SlotTemplate[]): SlotTemplate[] {
  return templates
    .filter((t) => t.active)
    .slice()
    .sort((a, b) => a.sortOrder - b.sortOrder || a.startTime.localeCompare(b.startTime))
}

/** true si `start < end` (créneau valide). */
export function validSlotTimes(startTime: string, endTime: string): boolean {
  return startTime < endTime
}

// ---------------------------------------------------------------------------
// Planning hebdomadaire
// ---------------------------------------------------------------------------

export interface Assignment {
  date: DateStr
  slotTemplateId: string
  memberId: string
}

/** Affectations explicites d'une semaine (lignes assignées, validées ou non). */
export function weekAssignments(slots: WalkSlot[], monday: DateStr): Assignment[] {
  const dates = new Set(weekDates(monday))
  return slots
    .filter((s) => dates.has(s.date) && s.assignedMemberId)
    .map((s) => ({ date: s.date, slotTemplateId: s.slotTemplateId, memberId: s.assignedMemberId! }))
}

/**
 * Affectations à créer pour reproduire la semaine `fromMonday` sur la semaine
 * `toMonday` (même jour de semaine, même créneau, même membre).
 */
export function duplicateWeekAssignments(
  slots: WalkSlot[],
  fromMonday: DateStr,
  toMonday: DateStr,
): Assignment[] {
  const from = weekDates(fromMonday)
  const to = weekDates(toMonday)
  return weekAssignments(slots, fromMonday).map((a) => ({
    ...a,
    date: to[from.indexOf(a.date)],
  }))
}

/** Capture la semaine `monday` en semaine type. */
export function weekTemplateFromWeek(
  slots: WalkSlot[],
  monday: DateStr,
  householdId: string,
): WeekTemplate {
  const assignments: Record<string, string> = {}
  for (const a of weekAssignments(slots, monday)) {
    assignments[`${weekdayIndex(a.date)}-${a.slotTemplateId}`] = a.memberId
  }
  return { householdId, assignments }
}

/** Affectations concrètes produites par l'application d'une semaine type. */
export function applyWeekTemplate(template: WeekTemplate, monday: DateStr): Assignment[] {
  const dates = weekDates(monday)
  return Object.entries(template.assignments).map(([key, memberId]) => {
    const sep = key.indexOf('-')
    const weekday = Number(key.slice(0, sep))
    return { date: dates[weekday], slotTemplateId: key.slice(sep + 1), memberId }
  })
}

export { mondayOf }

// ---------------------------------------------------------------------------
// Périodes de garde
// ---------------------------------------------------------------------------

export function activeCarePeriod(periods: CarePeriod[], at: Date): CarePeriod | undefined {
  return periods.find((p) => parseIso(p.startAt) <= at && at < parseIso(p.endAt))
}

/**
 * Gardien par défaut : sans période de garde en cours, le chien est chez son
 * propriétaire, sans durée déterminée.
 */
export function defaultKeeper(members: Member[]): Member | undefined {
  return membersByPriority(members).find((m) => m.role === 'owner')
}

export function nextCarePeriod(periods: CarePeriod[], at: Date): CarePeriod | undefined {
  return periods
    .filter((p) => parseIso(p.startAt) > at)
    .sort((a, b) => a.startAt.localeCompare(b.startAt))[0]
}

/** Périodes chevauchant l'intervalle candidat (en excluant `excludeId`). */
export function carePeriodConflicts(
  periods: CarePeriod[],
  startAt: string,
  endAt: string,
  excludeId?: string,
): CarePeriod[] {
  const s = parseIso(startAt)
  const e = parseIso(endAt)
  return periods.filter(
    (p) => p.id !== excludeId && parseIso(p.startAt) < e && s < parseIso(p.endAt),
  )
}

/** Périodes de garde touchant la semaine `monday`, triées. */
export function carePeriodsOfWeek(periods: CarePeriod[], monday: DateStr): CarePeriod[] {
  const weekStart = atTime(monday, '00:00')
  const weekEnd = atTime(weekDates(monday)[6], '23:59')
  return periods
    .filter((p) => parseIso(p.startAt) <= weekEnd && parseIso(p.endAt) >= weekStart)
    .sort((a, b) => a.startAt.localeCompare(b.startAt))
}

// ---------------------------------------------------------------------------
// Cascade de remplacement
// ---------------------------------------------------------------------------

/** Membres triés selon l'ordre de priorité défini par le propriétaire. */
export function membersByPriority(members: Member[]): Member[] {
  return members.slice().sort((a, b) => a.priorityRank - b.priorityRank)
}

/**
 * Prochain membre à notifier pour une demande : le premier de la liste de
 * priorité qui n'est ni le demandeur ni déjà sollicité. `null` si épuisé.
 */
export function nextCascadeTarget(
  members: Member[],
  requesterId: string,
  cascade: CascadeStep[],
): string | null {
  const already = new Set(cascade.map((s) => s.memberId))
  const candidate = membersByPriority(members).find(
    (m) => m.id !== requesterId && !already.has(m.id) && m.role !== 'guest',
  )
  return candidate?.id ?? null
}

/** Cible courante d'une demande ouverte (dernier maillon sans réponse). */
export function currentCascadeTarget(swap: SwapRequest): string | null {
  if (swap.status !== 'open') return null
  const last = swap.cascade[swap.cascade.length - 1]
  return last && !last.response ? last.memberId : null
}

/** Demandes ouvertes dont `memberId` est la cible courante. */
export function swapsTargeting(swaps: SwapRequest[], memberId: string): SwapRequest[] {
  return swaps.filter((s) => currentCascadeTarget(s) === memberId)
}

/** Demandes épuisées (toute la cascade a refusé) encore ouvertes à tous. */
export function exhaustedSwaps(swaps: SwapRequest[]): SwapRequest[] {
  return swaps.filter((s) => s.status === 'exhausted')
}

// ---------------------------------------------------------------------------
// Galerie
// ---------------------------------------------------------------------------

export interface GalleryItem {
  photo: PhotoRef
  createdAt: string
  source: 'walk' | 'chat'
  authorId?: string
  caption?: string
}

/**
 * Toutes les photos du foyer (validations + discussion), les plus récentes
 * d'abord. Une même photo (ex. validation reprise en message système) n'appa-
 * raît qu'une fois — la source « walk » est préférée.
 */
export function galleryItems(walkSlots: WalkSlot[], messages: Message[]): GalleryItem[] {
  const items: GalleryItem[] = []
  for (const s of walkSlots) {
    if (s.photo && s.validatedAt) {
      items.push({
        photo: s.photo,
        createdAt: s.validatedAt,
        source: 'walk',
        authorId: s.validatedBy,
        caption: s.note,
      })
    }
  }
  for (const m of messages) {
    if (m.photo) {
      items.push({
        photo: m.photo,
        createdAt: m.createdAt,
        source: 'chat',
        authorId: m.authorId,
        caption: m.kind === 'user' ? m.text || undefined : undefined,
      })
    }
  }
  const seen = new Map<string, GalleryItem>()
  for (const item of items) {
    const existing = seen.get(item.photo)
    if (!existing || (existing.source === 'chat' && item.source === 'walk')) {
      seen.set(item.photo, item)
    }
  }
  return [...seen.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}
