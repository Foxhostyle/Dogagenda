/**
 * Provider Supabase : Postgres + RLS, Realtime, Storage.
 *
 * Les opérations multi-lignes sensibles (création/adhésion de foyer, cascade
 * de remplacement) passent par des fonctions RPC `security definer` définies
 * dans supabase/migrations — atomiques et à l'abri des conditions de course.
 * Le reste est du CRUD simple protégé par les politiques RLS.
 */
import { createClient, type RealtimeChannel, type SupabaseClient } from '@supabase/supabase-js'
import { newId, normalizeInviteCode } from '../lib/ids'
import type { DateStr } from '../lib/dates'
import type {
  AppSnapshot,
  CarePeriod,
  Household,
  Member,
  Message,
  NotificationPrefs,
  Pet,
  PhotoRef,
  Session,
  SlotTemplate,
  SwapRequest,
  WalkSlot,
  WeekTemplate,
} from '../domain/types'
import type {
  CreateHouseholdInput,
  CreateSwapInput,
  DataProvider,
  JoinHouseholdInput,
  SendMessageInput,
  ValidateWalkInput,
} from './provider'

/* eslint-disable @typescript-eslint/no-explicit-any */
type Row = Record<string, any>

const time = (t: string | null): string => (t ?? '').slice(0, 5)

const mapHousehold = (r: Row): Household => ({
  id: r.id,
  name: r.name,
  inviteCode: r.invite_code,
  swapEscalateMinutes: r.swap_escalate_minutes ?? 30,
  createdAt: r.created_at,
})

const mapMember = (r: Row): Member => ({
  id: r.id,
  householdId: r.household_id,
  name: r.name,
  emoji: r.emoji,
  color: r.color,
  role: r.role,
  priorityRank: r.priority_rank,
  calendarToken: r.calendar_token ?? undefined,
  createdAt: r.created_at,
})

const mapPet = (r: Row): Pet => ({
  id: r.id,
  householdId: r.household_id,
  name: r.name,
  photo: r.photo ?? undefined,
  breed: r.breed ?? undefined,
  birthDate: r.birth_date ?? undefined,
  notes: r.notes ?? undefined,
})

const mapTemplate = (r: Row): SlotTemplate => ({
  id: r.id,
  householdId: r.household_id,
  name: r.name,
  emoji: r.emoji,
  startTime: time(r.start_time),
  endTime: time(r.end_time),
  sortOrder: r.sort_order,
  active: r.active,
})

const mapCarePeriod = (r: Row): CarePeriod => ({
  id: r.id,
  petId: r.pet_id,
  memberId: r.member_id,
  startAt: r.start_at,
  endAt: r.end_at,
})

const mapWalkSlot = (r: Row): WalkSlot => ({
  id: r.id,
  petId: r.pet_id,
  date: r.date,
  slotTemplateId: r.slot_template_id,
  assignedMemberId: r.assigned_member_id ?? undefined,
  status: r.status,
  validatedBy: r.validated_by ?? undefined,
  validatedAt: r.validated_at ?? undefined,
  note: r.note ?? undefined,
  photo: r.photo ?? undefined,
})

const mapMessage = (r: Row): Message => ({
  id: r.id,
  householdId: r.household_id,
  authorId: r.author_id ?? undefined,
  kind: r.kind,
  text: r.text,
  photo: r.photo ?? undefined,
  refDate: r.ref_date ?? undefined,
  refSlotTemplateId: r.ref_slot_template_id ?? undefined,
  createdAt: r.created_at,
})

const mapSwap = (r: Row): SwapRequest => ({
  id: r.id,
  householdId: r.household_id,
  walkSlotDate: r.walk_slot_date ?? undefined,
  walkSlotTemplateId: r.walk_slot_template_id ?? undefined,
  carePeriodId: r.care_period_id ?? undefined,
  requesterId: r.requester_id,
  message: r.message ?? undefined,
  status: r.status,
  acceptedBy: r.accepted_by ?? undefined,
  cascade: r.cascade ?? [],
  createdAt: r.created_at,
  resolvedAt: r.resolved_at ?? undefined,
})

const mapPrefs = (r: Row): NotificationPrefs => ({
  memberId: r.member_id,
  walkReminder: r.walk_reminder,
  missedWalk: r.missed_walk,
  careReminder: r.care_reminder,
  swaps: r.swaps,
  chat: r.chat,
  leadMinutes: r.lead_minutes,
  quietStart: r.quiet_start ? time(r.quiet_start) : undefined,
  quietEnd: r.quiet_end ? time(r.quiet_end) : undefined,
})

function fail(error: { message: string } | null): void {
  if (error) throw new Error(error.message)
}

function isNetworkError(e: unknown): boolean {
  return /fetch|network|load failed|networkerror/i.test(String((e as Error)?.message ?? e))
}

/** « du matin 🌅 » / « de l’après-midi ☀️ » — article français correct. */
function slotName(template: { name: string; emoji: string } | undefined | null): string {
  if (!template) return ''
  const lower = template.name.toLowerCase()
  const article = /^[aeéèiouyh]/.test(lower) ? 'de l’' : 'du '
  return `${article}${lower} ${template.emoji}`
}

/** Cache local du dernier snapshot : l'app s'ouvre hors-ligne avec les dernières données. */
const CACHE_KEY = 'dogagenda.supabase.cache'
/** File des validations faites hors-ligne, rejouées au retour du réseau. */
const QUEUE_KEY = 'dogagenda.supabase.queue'

interface QueuedWalkOp {
  kind: 'validate' | 'skip'
  date: string
  slotTemplateId: string
  note?: string
  photo?: string
}

export class SupabaseProvider implements DataProvider {
  readonly mode = 'supabase' as const
  private client: SupabaseClient
  private session: Session | null = null
  private petId: string | null = null
  private listeners = new Set<() => void>()
  private channel: RealtimeChannel | null = null
  private reloadTimer: ReturnType<typeof setTimeout> | null = null

  constructor(url: string, anonKey: string) {
    this.client = createClient(url, anonKey)
    if (typeof window !== 'undefined') {
      window.addEventListener('online', () => void this.flushQueue())
    }
  }

  // --- Cache hors-ligne + file de synchro -------------------------------------

  private readCache(): { session: Session; snap: AppSnapshot } | null {
    try {
      const raw = localStorage.getItem(CACHE_KEY)
      return raw ? (JSON.parse(raw) as { session: Session; snap: AppSnapshot }) : null
    } catch {
      return null
    }
  }

  private writeCache(session: Session, snap: AppSnapshot): void {
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify({ session, snap }))
    } catch {
      // stockage plein : tant pis pour le cache
    }
  }

  private readQueue(): QueuedWalkOp[] {
    try {
      const raw = localStorage.getItem(QUEUE_KEY)
      return raw ? (JSON.parse(raw) as QueuedWalkOp[]) : []
    } catch {
      return []
    }
  }

  private writeQueue(queue: QueuedWalkOp[]): void {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(queue))
  }

  /** Rejoue les validations mises en file hors-ligne. */
  private async flushQueue(): Promise<void> {
    const queue = this.readQueue()
    if (queue.length === 0) return
    this.writeQueue([])
    for (const op of queue) {
      try {
        if (op.kind === 'validate') {
          await this.validateWalk({
            date: op.date,
            slotTemplateId: op.slotTemplateId,
            note: op.note,
            photo: op.photo,
          })
        } else {
          await this.skipWalk(op.date, op.slotTemplateId)
        }
      } catch (e) {
        if (isNetworkError(e)) {
          // Toujours hors-ligne : on remet l'opération en file.
          this.writeQueue([...this.readQueue(), op])
        }
      }
    }
    this.scheduleReload()
  }

  /** Applique une opération au snapshot en cache (retour visuel hors-ligne). */
  private applyToCache(op: QueuedWalkOp): void {
    const cache = this.readCache()
    if (!cache || !this.session || cache.session.householdId !== this.session.householdId) return
    let slot = cache.snap.walkSlots.find(
      (w) => w.date === op.date && w.slotTemplateId === op.slotTemplateId,
    )
    if (!slot) {
      slot = {
        id: `offline-${op.date}-${op.slotTemplateId}`,
        petId: cache.snap.pet.id,
        date: op.date,
        slotTemplateId: op.slotTemplateId,
        status: 'pending',
      }
      cache.snap.walkSlots.push(slot)
    }
    slot.status = op.kind === 'validate' ? 'done' : 'skipped'
    slot.validatedBy = this.session.memberId
    slot.validatedAt = new Date().toISOString()
    if (op.note) slot.note = op.note
    if (op.photo) slot.photo = op.photo
    this.writeCache(cache.session, cache.snap)
    this.scheduleReload()
  }

  /** Prévient la fonction edge `notify` (push immédiats) — sans bloquer l'UI. */
  private notifyServer(payload: Record<string, unknown>): void {
    void this.client.functions.invoke('notify', { body: payload }).catch(() => {
      // Les push retomberont sur le cron `reminders` si l'appel échoue.
    })
  }

  // --- Session ---------------------------------------------------------------

  private async ensureAuth(): Promise<string> {
    const { data } = await this.client.auth.getSession()
    if (data.session) return data.session.user.id
    const { data: anon, error } = await this.client.auth.signInAnonymously()
    fail(error)
    return anon.session!.user.id
  }

  async getSession(): Promise<Session | null> {
    const { data } = await this.client.auth.getSession()
    if (!data.session) return null
    try {
      const { data: rows, error } = await this.client
        .from('members')
        .select('id, household_id')
        .eq('user_id', data.session.user.id)
        .order('created_at', { ascending: false })
        .limit(1)
      fail(error)
      if (!rows || rows.length === 0) return null
      this.session = { householdId: rows[0].household_id, memberId: rows[0].id }
    } catch (e) {
      // Hors-ligne avec une session connue : on repart du cache local.
      const cache = this.readCache()
      if (isNetworkError(e) && cache) {
        this.session = cache.session
      } else {
        throw e
      }
    }
    this.openRealtime(this.session!.householdId)
    return this.session
  }

  async createHousehold(input: CreateHouseholdInput): Promise<Session> {
    await this.ensureAuth()
    const { data, error } = await this.client.rpc('create_household', {
      p_member_name: input.memberName,
      p_member_emoji: input.memberEmoji,
      p_member_color: input.memberColor,
      p_pet_name: input.petName,
      p_pet_breed: input.petBreed ?? null,
      p_pet_birth_date: input.petBirthDate ?? null,
      p_pet_photo: input.petPhoto ?? null,
    })
    fail(error)
    this.session = { householdId: data.household_id, memberId: data.member_id }
    this.openRealtime(this.session.householdId)
    return this.session
  }

  async joinHousehold(input: JoinHouseholdInput): Promise<Session> {
    await this.ensureAuth()
    const { data, error } = await this.client.rpc('join_household', {
      p_invite_code: normalizeInviteCode(input.inviteCode),
      p_member_name: input.memberName,
      p_member_emoji: input.memberEmoji,
      p_member_color: input.memberColor,
    })
    if (error) {
      throw new Error(
        error.message.includes('invite_not_found')
          ? 'Code d’invitation introuvable. Vérifie-le auprès du propriétaire.'
          : error.message,
      )
    }
    this.session = { householdId: data.household_id, memberId: data.member_id }
    this.openRealtime(this.session.householdId)
    return this.session
  }

  async loadDemoData(): Promise<Session> {
    throw new Error('Le foyer de démonstration n’est disponible qu’en mode démo.')
  }

  async switchMember(): Promise<Session> {
    throw new Error('Le changement de membre n’est disponible qu’en mode démo.')
  }

  async leave(): Promise<void> {
    this.closeRealtime()
    this.session = null
    this.petId = null
    await this.client.auth.signOut()
  }

  // --- Realtime ----------------------------------------------------------------

  private openRealtime(householdId: string): void {
    if (this.channel) return
    const notify = () => this.scheduleReload()
    this.channel = this.client
      .channel(`household:${householdId}`)
      .on('broadcast', { event: 'change' }, notify)
    for (const table of [
      'members',
      'pets',
      'slot_templates',
      'care_periods',
      'walk_slots',
      'messages',
      'swap_requests',
      'week_templates',
    ]) {
      this.channel = this.channel.on(
        'postgres_changes',
        { event: '*', schema: 'public', table },
        notify,
      )
    }
    this.channel.subscribe()
  }

  private closeRealtime(): void {
    if (this.channel) {
      void this.client.removeChannel(this.channel)
      this.channel = null
    }
  }

  /** Regroupe les rafales d'événements en un seul rechargement. */
  private scheduleReload(): void {
    if (this.reloadTimer) clearTimeout(this.reloadTimer)
    this.reloadTimer = setTimeout(() => {
      this.reloadTimer = null
      for (const l of this.listeners) l()
    }, 150)
  }

  subscribe(onChange: () => void): () => void {
    this.listeners.add(onChange)
    return () => this.listeners.delete(onChange)
  }

  /** Signale la mutation aux autres appareils (en plus de postgres_changes). */
  private broadcast(): void {
    void this.channel?.send({ type: 'broadcast', event: 'change', payload: {} })
    this.scheduleReload()
  }

  private requireSession(): Session {
    if (!this.session) throw new Error('Aucune session active.')
    return this.session
  }

  // --- Lecture -------------------------------------------------------------------

  async load(): Promise<AppSnapshot> {
    const session = this.requireSession()
    try {
      const snap = await this.loadRemote(session)
      this.writeCache(session, snap)
      return snap
    } catch (e) {
      const cache = this.readCache()
      if (isNetworkError(e) && cache && cache.session.householdId === session.householdId) {
        return cache.snap
      }
      throw e
    }
  }

  private async loadRemote(session: Session): Promise<AppSnapshot> {
    const hh = session.householdId

    const [households, members, pets] = await Promise.all([
      this.client.from('households').select('*').eq('id', hh),
      this.client.from('members').select('*').eq('household_id', hh),
      this.client.from('pets').select('*').eq('household_id', hh),
    ])
    fail(households.error)
    fail(members.error)
    fail(pets.error)
    if (!households.data?.[0] || !pets.data?.[0]) throw new Error('Foyer introuvable.')
    const pet = mapPet(pets.data[0])
    this.petId = pet.id

    const [templates, periods, slots, messages, swaps, prefs, weekTemplates] = await Promise.all([
      this.client.from('slot_templates').select('*').eq('household_id', hh),
      this.client.from('care_periods').select('*').eq('pet_id', pet.id).order('start_at'),
      this.client.from('walk_slots').select('*').eq('pet_id', pet.id),
      this.client.from('messages').select('*').eq('household_id', hh).order('created_at'),
      this.client
        .from('swap_requests')
        .select('*')
        .eq('household_id', hh)
        .order('created_at', { ascending: false }),
      this.client.from('notification_prefs').select('*'),
      this.client.from('week_templates').select('*').eq('household_id', hh),
    ])
    for (const r of [templates, periods, slots, messages, swaps, prefs, weekTemplates]) {
      fail(r.error)
    }

    return {
      household: mapHousehold(households.data[0]),
      members: (members.data ?? []).map(mapMember).sort((a, b) => a.priorityRank - b.priorityRank),
      pet,
      slotTemplates: (templates.data ?? []).map(mapTemplate),
      carePeriods: (periods.data ?? []).map(mapCarePeriod),
      walkSlots: (slots.data ?? []).map(mapWalkSlot),
      messages: (messages.data ?? []).map(mapMessage),
      swapRequests: (swaps.data ?? []).map(mapSwap),
      prefs: (prefs.data ?? []).map(mapPrefs),
      weekTemplate: weekTemplates.data?.[0]
        ? { householdId: hh, assignments: weekTemplates.data[0].assignments ?? {} }
        : null,
    }
  }

  private async requirePetId(): Promise<string> {
    if (this.petId) return this.petId
    const session = this.requireSession()
    const { data, error } = await this.client
      .from('pets')
      .select('id')
      .eq('household_id', session.householdId)
    fail(error)
    if (!data?.[0]) throw new Error('Animal introuvable.')
    this.petId = data[0].id
    return this.petId!
  }

  // --- Promenades -------------------------------------------------------------------

  private async upsertSlot(
    date: DateStr,
    slotTemplateId: string,
    patch: Row,
  ): Promise<void> {
    const petId = await this.requirePetId()
    const { error } = await this.client
      .from('walk_slots')
      .upsert(
        { pet_id: petId, date, slot_template_id: slotTemplateId, ...patch },
        { onConflict: 'pet_id,date,slot_template_id' },
      )
    fail(error)
    this.broadcast()
  }

  async validateWalk(input: ValidateWalkInput): Promise<void> {
    const session = this.requireSession()
    try {
      await this.upsertSlot(input.date, input.slotTemplateId, {
        status: 'done',
        validated_by: session.memberId,
        validated_at: new Date().toISOString(),
        ...(input.note ? { note: input.note } : {}),
        ...(input.photo ? { photo: input.photo } : {}),
      })
    } catch (e) {
      if (!isNetworkError(e)) throw e
      // Hors-ligne : on met la validation en file et on l'affiche localement.
      this.writeQueue([
        ...this.readQueue(),
        { kind: 'validate', date: input.date, slotTemplateId: input.slotTemplateId, note: input.note, photo: input.photo },
      ])
      this.applyToCache({ kind: 'validate', date: input.date, slotTemplateId: input.slotTemplateId, note: input.note, photo: input.photo })
      return
    }
    // Message système dans le fil (avec la photo éventuelle).
    const { data: tpl } = await this.client
      .from('slot_templates')
      .select('name, emoji')
      .eq('id', input.slotTemplateId)
    const { data: me } = await this.client
      .from('members')
      .select('name')
      .eq('id', session.memberId)
    const { error } = await this.client.from('messages').insert({
      household_id: session.householdId,
      kind: 'system',
      text: `${me?.[0]?.name ?? 'Quelqu’un'} a validé la promenade ${slotName(tpl?.[0])} ✅`,
      photo: input.photo ?? null,
      ref_date: input.date,
      ref_slot_template_id: input.slotTemplateId,
    })
    fail(error)
    this.broadcast()
  }

  async unvalidateWalk(date: DateStr, slotTemplateId: string): Promise<void> {
    await this.upsertSlot(date, slotTemplateId, {
      status: 'pending',
      validated_by: null,
      validated_at: null,
    })
  }

  async skipWalk(date: DateStr, slotTemplateId: string): Promise<void> {
    const session = this.requireSession()
    try {
      await this.upsertSlot(date, slotTemplateId, {
        status: 'skipped',
        validated_by: session.memberId,
        validated_at: new Date().toISOString(),
      })
    } catch (e) {
      if (!isNetworkError(e)) throw e
      this.writeQueue([...this.readQueue(), { kind: 'skip', date, slotTemplateId }])
      this.applyToCache({ kind: 'skip', date, slotTemplateId })
    }
  }

  async attachToWalk(
    date: DateStr,
    slotTemplateId: string,
    patch: { note?: string; photo?: PhotoRef },
  ): Promise<void> {
    await this.upsertSlot(date, slotTemplateId, {
      ...(patch.note !== undefined ? { note: patch.note } : {}),
      ...(patch.photo !== undefined ? { photo: patch.photo } : {}),
    })
  }

  async assignWalk(date: DateStr, slotTemplateId: string, memberId: string | null): Promise<void> {
    await this.upsertSlot(date, slotTemplateId, { assigned_member_id: memberId })
  }

  async assignWalks(
    assignments: { date: DateStr; slotTemplateId: string; memberId: string }[],
  ): Promise<void> {
    const petId = await this.requirePetId()
    const rows = assignments.map((a) => ({
      pet_id: petId,
      date: a.date,
      slot_template_id: a.slotTemplateId,
      assigned_member_id: a.memberId,
    }))
    const { error } = await this.client
      .from('walk_slots')
      .upsert(rows, { onConflict: 'pet_id,date,slot_template_id' })
    fail(error)
    this.broadcast()
  }

  async duplicateWeek(fromMonday: DateStr, toMonday: DateStr): Promise<number> {
    const { duplicateWeekAssignments } = await import('../domain/logic')
    const snapshot = await this.load()
    const valid = new Set(snapshot.slotTemplates.map((t) => t.id))
    const assignments = duplicateWeekAssignments(snapshot.walkSlots, fromMonday, toMonday).filter(
      (a) => valid.has(a.slotTemplateId),
    )
    if (assignments.length > 0) await this.assignWalks(assignments)
    return assignments.length
  }

  async saveWeekTemplate(monday: DateStr): Promise<void> {
    const session = this.requireSession()
    const { weekTemplateFromWeek } = await import('../domain/logic')
    const snapshot = await this.load()
    const template = weekTemplateFromWeek(snapshot.walkSlots, monday, session.householdId)
    const { error } = await this.client
      .from('week_templates')
      .upsert(
        { household_id: session.householdId, assignments: template.assignments },
        { onConflict: 'household_id' },
      )
    fail(error)
    this.broadcast()
  }

  async applyWeekTemplate(monday: DateStr): Promise<number> {
    const { applyWeekTemplate } = await import('../domain/logic')
    const snapshot = await this.load()
    if (!snapshot.weekTemplate) throw new Error('Aucune semaine type enregistrée pour le moment.')
    const valid = new Set(snapshot.slotTemplates.map((t) => t.id))
    const assignments = applyWeekTemplate(snapshot.weekTemplate, monday).filter((a) =>
      valid.has(a.slotTemplateId),
    )
    if (assignments.length > 0) await this.assignWalks(assignments)
    return assignments.length
  }

  // --- Gardes -------------------------------------------------------------------

  async upsertCarePeriod(period: Omit<CarePeriod, 'id'> & { id?: string }): Promise<void> {
    const session = this.requireSession()
    const petId = await this.requirePetId()
    const { carePeriodConflicts } = await import('../domain/logic')
    const snapshot = await this.load()
    const conflicts = carePeriodConflicts(
      snapshot.carePeriods,
      period.startAt,
      period.endAt,
      period.id,
    )
    if (conflicts.length > 0) {
      const name = snapshot.members.find((m) => m.id === conflicts[0].memberId)?.name ?? 'quelqu’un'
      throw new Error(`Cette période chevauche la garde de ${name}.`)
    }
    if (period.startAt >= period.endAt) {
      throw new Error('La fin de la garde doit être après son début.')
    }
    const row = {
      id: period.id ?? newId(),
      pet_id: petId,
      member_id: period.memberId,
      start_at: period.startAt,
      end_at: period.endAt,
    }
    const { error } = await this.client.from('care_periods').upsert(row)
    if (error) {
      // Contrainte d'exclusion en base : deux appareils simultanés.
      throw new Error(
        /care_periods_no_overlap|exclusion/i.test(error.message)
          ? 'Cette période chevauche une garde déjà enregistrée.'
          : error.message,
      )
    }
    if (!period.id) {
      const { formatInstant } = await import('../lib/dates')
      const name = snapshot.members.find((m) => m.id === period.memberId)?.name ?? 'Quelqu’un'
      await this.client.from('messages').insert({
        household_id: session.householdId,
        kind: 'system',
        text: `${name} garde ${snapshot.pet.name} du ${formatInstant(period.startAt)} au ${formatInstant(period.endAt)} 🏡`,
      })
    }
    this.broadcast()
  }

  async deleteCarePeriod(id: string): Promise<void> {
    const { error } = await this.client.from('care_periods').delete().eq('id', id)
    fail(error)
    this.broadcast()
  }

  // --- Discussion ------------------------------------------------------------------

  async sendMessage(input: SendMessageInput): Promise<void> {
    const session = this.requireSession()
    const { error } = await this.client.from('messages').insert({
      household_id: session.householdId,
      author_id: session.memberId,
      kind: 'user',
      text: input.text,
      photo: input.photo ?? null,
      ref_date: input.refDate ?? null,
      ref_slot_template_id: input.refSlotTemplateId ?? null,
    })
    fail(error)
    // Push « nouveau message » aux membres qui l'ont activé.
    this.notifyServer({
      type: 'message-sent',
      householdId: session.householdId,
      authorMemberId: session.memberId,
      preview: input.text.slice(0, 90) || '📷 Photo',
    })
    this.broadcast()
  }

  // --- Remplacements -----------------------------------------------------------------

  async createSwapRequest(input: CreateSwapInput): Promise<void> {
    const { data, error } = await this.client.rpc('create_swap_request', {
      p_walk_slot_date: input.walkSlotDate ?? null,
      p_walk_slot_template_id: input.walkSlotTemplateId ?? null,
      p_care_period_id: input.carePeriodId ?? null,
      p_message: input.message ?? null,
    })
    fail(error)
    // Push immédiat vers la première cible de la cascade.
    if (data?.swap_id) this.notifyServer({ type: 'swap-created', swapId: data.swap_id })
    this.broadcast()
  }

  async respondSwap(swapId: string, accept: boolean): Promise<void> {
    const { error } = await this.client.rpc('respond_swap', {
      p_swap_id: swapId,
      p_accept: accept,
    })
    fail(error)
    // accepté → push au demandeur ; refusé → push à la nouvelle cible (ou SOS).
    this.notifyServer({ type: accept ? 'swap-accepted' : 'swap-advanced', swapId })
    this.broadcast()
  }

  async cancelSwap(swapId: string): Promise<void> {
    const { error } = await this.client
      .from('swap_requests')
      .update({ status: 'cancelled', resolved_at: new Date().toISOString() })
      .eq('id', swapId)
      .in('status', ['open', 'exhausted'])
    fail(error)
    this.broadcast()
  }

  // --- Réglages ---------------------------------------------------------------------

  async updatePet(patch: Partial<Omit<Pet, 'id' | 'householdId'>>): Promise<void> {
    const petId = await this.requirePetId()
    const row: Row = {}
    // La présence de la clé fait foi : `undefined` efface la valeur (→ null).
    if ('name' in patch && patch.name) row.name = patch.name
    if ('photo' in patch) row.photo = patch.photo ?? null
    if ('breed' in patch) row.breed = patch.breed ?? null
    if ('birthDate' in patch) row.birth_date = patch.birthDate ?? null
    if ('notes' in patch) row.notes = patch.notes ?? null
    const { error } = await this.client.from('pets').update(row).eq('id', petId)
    fail(error)
    this.broadcast()
  }

  async updateMember(
    memberId: string,
    patch: Partial<Pick<Member, 'name' | 'emoji' | 'color'>>,
  ): Promise<void> {
    const { error } = await this.client.from('members').update(patch).eq('id', memberId)
    fail(error)
    this.broadcast()
  }

  async updateMemberPriorities(memberIdsInOrder: string[]): Promise<void> {
    const { error } = await this.client.rpc('update_member_priorities', {
      p_member_ids: memberIdsInOrder,
    })
    fail(error)
    this.broadcast()
  }

  async removeMember(memberId: string): Promise<void> {
    const { error } = await this.client.rpc('remove_member', { p_member_id: memberId })
    fail(error)
    this.broadcast()
  }

  async upsertSlotTemplate(template: Omit<SlotTemplate, 'householdId'>): Promise<void> {
    const session = this.requireSession()
    if (template.startTime >= template.endTime) {
      throw new Error('L’heure de fin doit être après l’heure de début.')
    }
    const { error } = await this.client.from('slot_templates').upsert({
      id: template.id,
      household_id: session.householdId,
      name: template.name,
      emoji: template.emoji,
      start_time: template.startTime,
      end_time: template.endTime,
      sort_order: template.sortOrder,
      active: template.active,
    })
    fail(error)
    this.broadcast()
  }

  async deleteSlotTemplate(id: string): Promise<void> {
    await this.client.from('walk_slots').delete().eq('slot_template_id', id).eq('status', 'pending')
    // Des promenades validées existent ? On désactive le créneau au lieu de le
    // supprimer, pour préserver l'historique et la galerie (promesse de l'UI).
    const { data: remaining, error: countError } = await this.client
      .from('walk_slots')
      .select('id')
      .eq('slot_template_id', id)
      .limit(1)
    fail(countError)
    if (remaining && remaining.length > 0) {
      const { error } = await this.client
        .from('slot_templates')
        .update({ active: false })
        .eq('id', id)
      fail(error)
    } else {
      const { error } = await this.client.from('slot_templates').delete().eq('id', id)
      fail(error)
    }
    this.broadcast()
  }

  async updatePrefs(patch: Partial<Omit<NotificationPrefs, 'memberId'>>): Promise<void> {
    const session = this.requireSession()
    const row: Row = { member_id: session.memberId }
    if (patch.walkReminder !== undefined) row.walk_reminder = patch.walkReminder
    if (patch.missedWalk !== undefined) row.missed_walk = patch.missedWalk
    if (patch.careReminder !== undefined) row.care_reminder = patch.careReminder
    if (patch.swaps !== undefined) row.swaps = patch.swaps
    if (patch.chat !== undefined) row.chat = patch.chat
    if (patch.leadMinutes !== undefined) row.lead_minutes = patch.leadMinutes
    // Clé présente + valeur vide/undefined = effacement (→ null).
    if ('quietStart' in patch) row.quiet_start = patch.quietStart || null
    if ('quietEnd' in patch) row.quiet_end = patch.quietEnd || null
    const { error } = await this.client
      .from('notification_prefs')
      .upsert(row, { onConflict: 'member_id' })
    fail(error)
    this.broadcast()
  }

  async updateHousehold(patch: { swapEscalateMinutes?: number }): Promise<void> {
    const session = this.requireSession()
    const row: Row = {}
    if (patch.swapEscalateMinutes !== undefined) {
      row.swap_escalate_minutes = patch.swapEscalateMinutes
    }
    const { error } = await this.client
      .from('households')
      .update(row)
      .eq('id', session.householdId)
    fail(error)
    this.broadcast()
  }

  // --- Photos -----------------------------------------------------------------------

  async savePhoto(blob: Blob): Promise<PhotoRef> {
    const session = this.requireSession()
    const path = `${session.householdId}/${newId()}.jpg`
    const { error } = await this.client.storage
      .from('photos')
      .upload(path, blob, { contentType: 'image/jpeg' })
    fail(error)
    const { data } = this.client.storage.from('photos').getPublicUrl(path)
    return data.publicUrl
  }

  async savePushSubscription(subscription: PushSubscriptionJSON | null): Promise<void> {
    const session = this.requireSession()
    const { error } = await this.client
      .from('members')
      .update({ push_subscription: subscription })
      .eq('id', session.memberId)
    fail(error)
  }
}

export type { WeekTemplate }
