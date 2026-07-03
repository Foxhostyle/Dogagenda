import type { DateStr } from '../lib/dates'
import type {
  AppSnapshot,
  CarePeriod,
  Member,
  NotificationPrefs,
  Pet,
  PhotoRef,
  Session,
  SlotTemplate,
  SwapRequest,
} from '../domain/types'

export interface CreateHouseholdInput {
  memberName: string
  memberEmoji: string
  memberColor: string
  petName: string
  petBreed?: string
  petBirthDate?: DateStr
  petPhoto?: PhotoRef
}

export interface JoinHouseholdInput {
  inviteCode: string
  memberName: string
  memberEmoji: string
  memberColor: string
}

export interface ValidateWalkInput {
  date: DateStr
  slotTemplateId: string
  /** Note/photo optionnelles, ajoutables aussi après coup via attachToWalk. */
  note?: string
  photo?: PhotoRef
}

export interface SendMessageInput {
  text: string
  photo?: PhotoRef
  refDate?: DateStr
  refSlotTemplateId?: string
}

export interface CreateSwapInput {
  /** Cible : soit une promenade (date + créneau), soit une période de garde. */
  walkSlotDate?: DateStr
  walkSlotTemplateId?: string
  carePeriodId?: string
  message?: string
}

/**
 * Contrat de la couche de données. Deux implémentations :
 * - DemoProvider  : tout en local (localStorage + IndexedDB), multi-onglets.
 * - SupabaseProvider : Postgres + Realtime + Storage.
 *
 * Toutes les mutations déclenchent l'émission d'un changement (subscribe) —
 * le store recharge alors un snapshot complet. À l'échelle d'un foyer,
 * recharger tout est simple, robuste et instantané.
 */
export interface DataProvider {
  readonly mode: 'demo' | 'supabase'

  // --- Session -------------------------------------------------------------
  getSession(): Promise<Session | null>
  createHousehold(input: CreateHouseholdInput): Promise<Session>
  joinHousehold(input: JoinHouseholdInput): Promise<Session>
  /** Charge le foyer de démonstration pré-rempli (mode démo uniquement). */
  loadDemoData(): Promise<Session>
  /** Change de membre actif sur cet appareil (mode démo uniquement). */
  switchMember(memberId: string): Promise<Session>
  leave(): Promise<void>

  // --- Lecture / abonnement -------------------------------------------------
  load(): Promise<AppSnapshot>
  /** Notifie à chaque changement (local ou distant). Retourne un désabonnement. */
  subscribe(onChange: () => void): () => void

  // --- Promenades ------------------------------------------------------------
  validateWalk(input: ValidateWalkInput): Promise<void>
  /** Annule une validation (retour à `pending`). */
  unvalidateWalk(date: DateStr, slotTemplateId: string): Promise<void>
  skipWalk(date: DateStr, slotTemplateId: string): Promise<void>
  /** Ajoute note/photo à une promenade déjà validée. */
  attachToWalk(date: DateStr, slotTemplateId: string, patch: { note?: string; photo?: PhotoRef }): Promise<void>
  /** memberId `null` = désassigner. */
  assignWalk(date: DateStr, slotTemplateId: string, memberId: string | null): Promise<void>
  assignWalks(assignments: { date: DateStr; slotTemplateId: string; memberId: string }[]): Promise<void>
  duplicateWeek(fromMonday: DateStr, toMonday: DateStr): Promise<number>
  saveWeekTemplate(monday: DateStr): Promise<void>
  applyWeekTemplate(monday: DateStr): Promise<number>

  // --- Gardes ----------------------------------------------------------------
  upsertCarePeriod(period: Omit<CarePeriod, 'id'> & { id?: string }): Promise<void>
  deleteCarePeriod(id: string): Promise<void>

  // --- Discussion ------------------------------------------------------------
  sendMessage(input: SendMessageInput): Promise<void>

  // --- Remplacements ----------------------------------------------------------
  createSwapRequest(input: CreateSwapInput): Promise<void>
  /** accept=false : refuse et fait avancer la cascade. */
  respondSwap(swapId: string, accept: boolean): Promise<void>
  cancelSwap(swapId: string): Promise<void>

  // --- Réglages ----------------------------------------------------------------
  updatePet(patch: Partial<Omit<Pet, 'id' | 'householdId'>>): Promise<void>
  updateMember(memberId: string, patch: Partial<Pick<Member, 'name' | 'emoji' | 'color'>>): Promise<void>
  /** Réordonne la cascade : ids dans le nouvel ordre de priorité. */
  updateMemberPriorities(memberIdsInOrder: string[]): Promise<void>
  removeMember(memberId: string): Promise<void>
  upsertSlotTemplate(template: Omit<SlotTemplate, 'householdId'>): Promise<void>
  deleteSlotTemplate(id: string): Promise<void>
  updatePrefs(patch: Partial<Omit<NotificationPrefs, 'memberId'>>): Promise<void>

  // --- Photos -----------------------------------------------------------------
  /** Stocke une photo (compressée en amont) et retourne sa référence. */
  savePhoto(blob: Blob): Promise<PhotoRef>

  // --- Notifications push -------------------------------------------------------
  /** Enregistre (ou efface avec null) l'abonnement Web Push du membre actif. */
  savePushSubscription(subscription: PushSubscriptionJSON | null): Promise<void>
}

/** Utilitaire partagé : libellé humain d'une demande de remplacement. */
export type { SwapRequest }
