/**
 * Données de démonstration : un foyer vivant, construit relativement à
 * aujourd'hui pour que l'écran d'accueil soit toujours parlant.
 */
import { addDaysStr, atTime, mondayOf, todayStr, weekDates } from '../lib/dates'
import { DEFAULT_PREFS } from './types'
import type {
  CarePeriod,
  Household,
  Member,
  Message,
  NotificationPrefs,
  Pet,
  SlotTemplate,
  SwapRequest,
  WalkSlot,
} from './types'

export interface SeedDb {
  household: Household
  members: Member[]
  pet: Pet
  slotTemplates: SlotTemplate[]
  carePeriods: CarePeriod[]
  walkSlots: WalkSlot[]
  messages: Message[]
  swapRequests: SwapRequest[]
  prefs: NotificationPrefs[]
}

export const DEMO_HOUSEHOLD_ID = 'hh-demo'
export const DEMO_MEMBER_ID = 'm-bastien'

export function buildDemoSeed(now: Date = new Date()): SeedDb {
  const today = todayStr(now)
  const monday = mondayOf(today)
  const week = weekDates(monday)
  const nextMonday = addDaysStr(monday, 7)
  const yesterday = addDaysStr(today, -1)
  const iso = (d: Date) => d.toISOString()
  const hh = DEMO_HOUSEHOLD_ID

  const household: Household = {
    id: hh,
    name: 'La famille de Wint',
    inviteCode: 'WINT24',
    createdAt: iso(atTime(addDaysStr(today, -60), '10:00')),
  }

  const members: Member[] = [
    { id: 'm-bastien', householdId: hh, name: 'Bastien', emoji: '🦊', color: '#578764', role: 'owner', priorityRank: 0, createdAt: household.createdAt },
    { id: 'm-lea', householdId: hh, name: 'Léa', emoji: '🐰', color: '#e76632', role: 'member', priorityRank: 1, createdAt: household.createdAt },
    { id: 'm-marco', householdId: hh, name: 'Marco', emoji: '🐻', color: '#4f78b8', role: 'member', priorityRank: 2, createdAt: household.createdAt },
    { id: 'm-jo', householdId: hh, name: 'Mamie Jo', emoji: '🦉', color: '#8a67ab', role: 'member', priorityRank: 3, createdAt: household.createdAt },
  ]

  const pet: Pet = {
    id: 'pet-wint',
    householdId: hh,
    name: 'Wint',
    breed: 'Berger australien',
    birthDate: '2023-02-14',
    notes: 'Adore les bâtons et les enfants. Ne pas lâcher près de la route. Véto : Clinique des Tilleuls, 04 78 00 00 00.',
  }

  const slotTemplates: SlotTemplate[] = [
    { id: 'st-matin', householdId: hh, name: 'Matin', emoji: '🌅', startTime: '07:00', endTime: '09:30', sortOrder: 0, active: true },
    { id: 'st-aprem', householdId: hh, name: 'Après-midi', emoji: '☀️', startTime: '14:00', endTime: '17:00', sortOrder: 1, active: true },
    { id: 'st-soir', householdId: hh, name: 'Soir', emoji: '🌙', startTime: '19:00', endTime: '21:30', sortOrder: 2, active: true },
  ]

  const carePeriods: CarePeriod[] = [
    { id: 'cp-1', petId: pet.id, memberId: 'm-bastien', startAt: iso(atTime(monday, '08:00')), endAt: iso(atTime(week[6], '20:00')) },
    { id: 'cp-2', petId: pet.id, memberId: 'm-lea', startAt: iso(atTime(week[6], '20:00')), endAt: iso(atTime(weekDates(nextMonday)[6], '20:00')) },
  ]

  // Rotation simple pour remplir la semaine.
  const rota = ['m-bastien', 'm-lea', 'm-marco']
  const walkSlots: WalkSlot[] = []
  const push = (date: string, st: string, memberId: string) =>
    walkSlots.push({
      id: `ws-${date}-${st}`,
      petId: pet.id,
      date,
      slotTemplateId: st,
      assignedMemberId: memberId,
      status: 'pending',
    })
  for (let d = 0; d < 7; d++) {
    push(week[d], 'st-matin', rota[d % 3])
    push(week[d], 'st-aprem', rota[(d + 1) % 3])
    push(week[d], 'st-soir', rota[(d + 2) % 3])
  }
  // Hier : tout validé.
  for (const st of ['st-matin', 'st-aprem', 'st-soir']) {
    const s = walkSlots.find((w) => w.date === yesterday && w.slotTemplateId === st)
    if (s) {
      s.status = 'done'
      s.validatedBy = s.assignedMemberId
      s.validatedAt = iso(atTime(yesterday, st === 'st-matin' ? '08:12' : st === 'st-aprem' ? '15:40' : '20:05'))
      if (st === 'st-soir') s.note = 'Grand tour du canal, il a couru comme un fou 🐾'
    }
  }
  // Aujourd'hui : le matin est déjà validé par Léa.
  const thisMorning = walkSlots.find((w) => w.date === today && w.slotTemplateId === 'st-matin')
  if (thisMorning) {
    thisMorning.status = 'done'
    thisMorning.validatedBy = 'm-lea'
    thisMorning.validatedAt = iso(atTime(today, '08:20'))
    thisMorning.note = 'Croisé le labrador du voisin, grande fête'
  }

  const messages: Message[] = [
    {
      id: 'msg-1', householdId: hh, authorId: 'm-lea', kind: 'user',
      text: 'Pensez à prendre le harnais bleu, l’autre lui frotte l’épaule 😊',
      createdAt: iso(atTime(yesterday, '18:45')),
    },
    {
      id: 'msg-2', householdId: hh, kind: 'system',
      text: 'Bastien a validé la promenade du soir 🌙 ✅',
      refDate: yesterday, refSlotTemplateId: 'st-soir',
      createdAt: iso(atTime(yesterday, '20:05')),
    },
    {
      id: 'msg-3', householdId: hh, authorId: 'm-marco', kind: 'user',
      text: 'Il a englouti sa gamelle ce matin, appétit d’ogre 👍',
      createdAt: iso(atTime(today, '07:55')),
    },
    {
      id: 'msg-4', householdId: hh, kind: 'system',
      text: 'Léa a validé la promenade du matin 🌅 ✅',
      refDate: today, refSlotTemplateId: 'st-matin',
      createdAt: iso(atTime(today, '08:20')),
    },
  ]

  // Marco cherche un remplaçant pour demain après-midi ; Bastien (priorité 1)
  // est la cible courante → l'utilisateur de la démo voit la demande à l'ouverture.
  const tomorrow = addDaysStr(today, 1)
  const swapRequests: SwapRequest[] = [
    {
      id: 'swap-1', householdId: hh,
      walkSlotDate: tomorrow, walkSlotTemplateId: 'st-aprem',
      requesterId: 'm-marco',
      message: 'Réunion au travail, impossible de me libérer 🙏',
      status: 'open',
      cascade: [{ memberId: 'm-bastien', notifiedAt: iso(atTime(today, '09:00')) }],
      createdAt: iso(atTime(today, '09:00')),
    },
  ]

  const prefs: NotificationPrefs[] = members.map((m) => ({ memberId: m.id, ...DEFAULT_PREFS }))

  return { household, members, pet, slotTemplates, carePeriods, walkSlots, messages, swapRequests, prefs }
}
