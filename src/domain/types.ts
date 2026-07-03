/**
 * Modèle de domaine de Dogagenda.
 *
 * Conventions :
 * - Les identifiants sont des chaînes (UUID côté Supabase, nanoid côté démo).
 * - Les dates calendaires sont au format `YYYY-MM-DD` (heure locale de l'appareil).
 * - Les instants sont des chaînes ISO 8601 (`toISOString()`).
 * - Les heures de créneaux sont au format `HH:mm`.
 * - Les références de photos (`PhotoRef`) sont résolues par la couche data :
 *   URL http(s) (Supabase Storage), data-URL, ou clé `idb:<id>` (mode démo).
 */

export type Role = 'owner' | 'member' | 'guest'
export type SlotStatus = 'pending' | 'done' | 'skipped'
export type SwapStatus = 'open' | 'accepted' | 'cancelled' | 'exhausted'
export type PhotoRef = string

export interface Household {
  id: string
  name: string
  inviteCode: string
  createdAt: string
}

export interface Member {
  id: string
  householdId: string
  name: string
  /** Émoji d'avatar choisi par le membre. */
  emoji: string
  /** Couleur d'avatar (hex), issue de la palette MEMBER_COLORS. */
  color: string
  role: Role
  /** Ordre dans la cascade de notifications (0 = notifié en premier). */
  priorityRank: number
  /** Jeton secret du flux iCal personnel (mode Supabase uniquement). */
  calendarToken?: string
  createdAt: string
}

export interface Pet {
  id: string
  householdId: string
  name: string
  photo?: PhotoRef
  breed?: string
  /** `YYYY-MM-DD` */
  birthDate?: string
  notes?: string
}

/** Créneau de promenade défini par le foyer (ex. « Matin » 07:00–09:00). */
export interface SlotTemplate {
  id: string
  householdId: string
  name: string
  emoji: string
  /** `HH:mm` */
  startTime: string
  /** `HH:mm` */
  endTime: string
  sortOrder: number
  active: boolean
}

/** Période de garde : qui a Wint, de quand à quand (dates + heures libres). */
export interface CarePeriod {
  id: string
  petId: string
  memberId: string
  /** ISO 8601 */
  startAt: string
  /** ISO 8601 */
  endAt: string
}

/**
 * Une promenade concrète (un jour × un créneau). Les créneaux non touchés
 * n'ont pas de ligne : ils sont implicitement `pending` et non assignés.
 */
export interface WalkSlot {
  id: string
  petId: string
  /** `YYYY-MM-DD` */
  date: string
  slotTemplateId: string
  assignedMemberId?: string
  status: SlotStatus
  /** Membre qui a réellement validé (peut différer de l'assigné). */
  validatedBy?: string
  validatedAt?: string
  note?: string
  photo?: PhotoRef
}

export interface Message {
  id: string
  householdId: string
  /** Absent pour les messages système. */
  authorId?: string
  kind: 'user' | 'system'
  text: string
  photo?: PhotoRef
  /** Contexte optionnel : jour et/ou promenade commentée. */
  refDate?: string
  refSlotTemplateId?: string
  createdAt: string
}

export interface CascadeStep {
  memberId: string
  notifiedAt: string
  response?: 'declined'
  respondedAt?: string
}

/** Demande de remplacement, notifiée en cascade selon la priorité. */
export interface SwapRequest {
  id: string
  householdId: string
  /** Exactement l'un des deux est renseigné. */
  walkSlotDate?: string
  walkSlotTemplateId?: string
  carePeriodId?: string
  requesterId: string
  message?: string
  status: SwapStatus
  acceptedBy?: string
  /** Historique de la cascade ; le dernier élément sans réponse est la cible courante. */
  cascade: CascadeStep[]
  createdAt: string
  resolvedAt?: string
}

export interface NotificationPrefs {
  memberId: string
  walkReminder: boolean
  missedWalk: boolean
  careReminder: boolean
  swaps: boolean
  chat: boolean
  /** Minutes d'anticipation du rappel avant créneau. */
  leadMinutes: number
  /** Heures de silence, `HH:mm` (optionnelles). */
  quietStart?: string
  quietEnd?: string
}

/** Semaine type : affectations par (jour de semaine × créneau). */
export interface WeekTemplate {
  householdId: string
  /** Clé `${weekday}-${slotTemplateId}` (weekday 0 = lundi) → memberId. */
  assignments: Record<string, string>
}

/** Instantané complet des données du foyer, consommé par le store. */
export interface AppSnapshot {
  household: Household
  members: Member[]
  pet: Pet
  slotTemplates: SlotTemplate[]
  carePeriods: CarePeriod[]
  walkSlots: WalkSlot[]
  messages: Message[]
  swapRequests: SwapRequest[]
  prefs: NotificationPrefs[]
  weekTemplate: WeekTemplate | null
}

export interface Session {
  householdId: string
  memberId: string
}

/** Palette d'avatars proposée aux membres. */
export const MEMBER_COLORS = [
  '#578764', // sauge
  '#e76632', // pêche
  '#4f78b8', // bleuet
  '#b8564f', // brique
  '#8a67ab', // lavande
  '#b8923e', // miel
  '#4f9ba1', // lagon
  '#b85a8a', // rose
] as const

export const MEMBER_EMOJIS = [
  '🦊', '🐻', '🐰', '🦉', '🐱', '🦁', '🐼', '🐸', '🦋', '🌻', '⭐', '🌙',
] as const

export const DEFAULT_PREFS: Omit<NotificationPrefs, 'memberId'> = {
  walkReminder: true,
  missedWalk: true,
  careReminder: true,
  swaps: true,
  chat: true,
  leadMinutes: 30,
}
