/**
 * Provider « démo » : toutes les données vivent sur l'appareil
 * (localStorage pour les entités, IndexedDB pour les photos).
 * Un BroadcastChannel synchronise les onglets ouverts — pratique pour
 * tester le temps réel sans serveur.
 */
import { formatDayShort, formatInstant, todayStr, type DateStr } from '../lib/dates'
import { newId, newInviteCode, normalizeInviteCode } from '../lib/ids'
import { storeLocalPhoto } from '../lib/photos'
import {
  applyWeekTemplate as applyTemplateAssignments,
  carePeriodConflicts,
  duplicateWeekAssignments,
  findWalkSlot,
  nextCascadeTarget,
  validSlotTimes,
  weekTemplateFromWeek,
} from '../domain/logic'
import { buildDemoSeed, DEMO_MEMBER_ID, type SeedDb } from '../domain/seed'
import { DEFAULT_PREFS } from '../domain/types'
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

const DB_KEY = 'dogagenda.demo.db'
const SESSION_KEY = 'dogagenda.demo.session'
const CHANNEL = 'dogagenda-demo'

interface DemoDb {
  households: Household[]
  members: Member[]
  pets: Pet[]
  slotTemplates: SlotTemplate[]
  carePeriods: CarePeriod[]
  walkSlots: WalkSlot[]
  messages: Message[]
  swapRequests: SwapRequest[]
  prefs: NotificationPrefs[]
  weekTemplates: WeekTemplate[]
}

function emptyDb(): DemoDb {
  return {
    households: [],
    members: [],
    pets: [],
    slotTemplates: [],
    carePeriods: [],
    walkSlots: [],
    messages: [],
    swapRequests: [],
    prefs: [],
    weekTemplates: [],
  }
}

function seedToDb(seed: SeedDb): DemoDb {
  return {
    households: [seed.household],
    members: seed.members,
    pets: [seed.pet],
    slotTemplates: seed.slotTemplates,
    carePeriods: seed.carePeriods,
    walkSlots: seed.walkSlots,
    messages: seed.messages,
    swapRequests: seed.swapRequests,
    prefs: seed.prefs,
    weekTemplates: [],
  }
}

export class DemoProvider implements DataProvider {
  readonly mode = 'demo' as const
  private listeners = new Set<() => void>()
  private channel: BroadcastChannel | null = null

  constructor() {
    if (typeof BroadcastChannel !== 'undefined') {
      this.channel = new BroadcastChannel(CHANNEL)
      this.channel.onmessage = () => this.notify(false)
    }
  }

  // --- Stockage --------------------------------------------------------------

  private readDb(): DemoDb {
    try {
      const raw = localStorage.getItem(DB_KEY)
      if (!raw) return emptyDb()
      return { ...emptyDb(), ...(JSON.parse(raw) as Partial<DemoDb>) }
    } catch {
      return emptyDb()
    }
  }

  private writeDb(db: DemoDb): void {
    localStorage.setItem(DB_KEY, JSON.stringify(db))
    this.channel?.postMessage('change')
    this.notify(false)
  }

  private notify(_remote: boolean): void {
    for (const l of this.listeners) l()
  }

  subscribe(onChange: () => void): () => void {
    this.listeners.add(onChange)
    return () => this.listeners.delete(onChange)
  }

  // --- Session ---------------------------------------------------------------

  async getSession(): Promise<Session | null> {
    try {
      const raw = localStorage.getItem(SESSION_KEY)
      if (!raw) return null
      const session = JSON.parse(raw) as Session
      const db = this.readDb()
      const valid =
        db.households.some((h) => h.id === session.householdId) &&
        db.members.some((m) => m.id === session.memberId)
      return valid ? session : null
    } catch {
      return null
    }
  }

  private setSession(session: Session | null): void {
    if (session) localStorage.setItem(SESSION_KEY, JSON.stringify(session))
    else localStorage.removeItem(SESSION_KEY)
  }

  private requireSession(): Session {
    const raw = localStorage.getItem(SESSION_KEY)
    if (!raw) throw new Error('Aucune session active.')
    return JSON.parse(raw) as Session
  }

  async createHousehold(input: CreateHouseholdInput): Promise<Session> {
    const db = this.readDb()
    const now = new Date().toISOString()
    const household: Household = {
      id: newId(),
      name: `La famille de ${input.petName}`,
      inviteCode: newInviteCode(),
      createdAt: now,
    }
    const member: Member = {
      id: newId(),
      householdId: household.id,
      name: input.memberName,
      emoji: input.memberEmoji,
      color: input.memberColor,
      role: 'owner',
      priorityRank: 0,
      createdAt: now,
    }
    const pet: Pet = {
      id: newId(),
      householdId: household.id,
      name: input.petName,
      breed: input.petBreed,
      birthDate: input.petBirthDate,
      photo: input.petPhoto,
    }
    const defaultTemplates: SlotTemplate[] = [
      { id: newId(), householdId: household.id, name: 'Matin', emoji: '☀️', startTime: '07:00', endTime: '09:30', sortOrder: 0, active: true },
      { id: newId(), householdId: household.id, name: 'Après-midi', emoji: '⛅', startTime: '14:00', endTime: '17:00', sortOrder: 1, active: true },
      { id: newId(), householdId: household.id, name: 'Soir', emoji: '🌙', startTime: '19:00', endTime: '21:30', sortOrder: 2, active: true },
    ]
    db.households.push(household)
    db.members.push(member)
    db.pets.push(pet)
    db.slotTemplates.push(...defaultTemplates)
    db.prefs.push({ memberId: member.id, ...DEFAULT_PREFS })
    this.writeDb(db)
    const session = { householdId: household.id, memberId: member.id }
    this.setSession(session)
    return session
  }

  async joinHousehold(input: JoinHouseholdInput): Promise<Session> {
    const db = this.readDb()
    const code = normalizeInviteCode(input.inviteCode)
    const household = db.households.find((h) => h.inviteCode === code)
    if (!household) {
      throw new Error(
        'Code introuvable. En mode démo (sans serveur configuré), on ne peut rejoindre qu’un foyer créé sur cet appareil.',
      )
    }
    const member: Member = {
      id: newId(),
      householdId: household.id,
      name: input.memberName,
      emoji: input.memberEmoji,
      color: input.memberColor,
      role: 'member',
      priorityRank: db.members.filter((m) => m.householdId === household.id).length,
      createdAt: new Date().toISOString(),
    }
    db.members.push(member)
    db.prefs.push({ memberId: member.id, ...DEFAULT_PREFS })
    this.pushSystemMessage(db, household.id, `${member.name} a rejoint la famille 👋`)
    this.writeDb(db)
    const session = { householdId: household.id, memberId: member.id }
    this.setSession(session)
    return session
  }

  async loadDemoData(): Promise<Session> {
    const db = seedToDb(buildDemoSeed())
    this.writeDb(db)
    const session = { householdId: db.households[0].id, memberId: DEMO_MEMBER_ID }
    this.setSession(session)
    return session
  }

  async switchMember(memberId: string): Promise<Session> {
    const session = this.requireSession()
    const db = this.readDb()
    const member = db.members.find((m) => m.id === memberId && m.householdId === session.householdId)
    if (!member) throw new Error('Membre introuvable.')
    const next = { householdId: session.householdId, memberId }
    this.setSession(next)
    this.notify(false)
    return next
  }

  async leave(): Promise<void> {
    this.setSession(null)
    this.notify(false)
  }

  // --- Lecture ----------------------------------------------------------------

  async load(): Promise<AppSnapshot> {
    const session = this.requireSession()
    const db = this.readDb()
    const household = db.households.find((h) => h.id === session.householdId)
    const pet = db.pets.find((p) => p.householdId === session.householdId)
    if (!household || !pet) throw new Error('Foyer introuvable.')
    const memberIds = new Set(
      db.members.filter((m) => m.householdId === household.id).map((m) => m.id),
    )
    return {
      household,
      members: db.members
        .filter((m) => m.householdId === household.id)
        .sort((a, b) => a.priorityRank - b.priorityRank),
      pet,
      slotTemplates: db.slotTemplates.filter((t) => t.householdId === household.id),
      carePeriods: db.carePeriods
        .filter((c) => c.petId === pet.id)
        .sort((a, b) => a.startAt.localeCompare(b.startAt)),
      walkSlots: db.walkSlots.filter((w) => w.petId === pet.id),
      messages: db.messages
        .filter((m) => m.householdId === household.id)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
      swapRequests: db.swapRequests
        .filter((s) => s.householdId === household.id)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
      prefs: db.prefs.filter((p) => memberIds.has(p.memberId)),
      weekTemplate: db.weekTemplates.find((t) => t.householdId === household.id) ?? null,
    }
  }

  // --- Aides internes -----------------------------------------------------------

  private pet(db: DemoDb, householdId: string): Pet {
    const pet = db.pets.find((p) => p.householdId === householdId)
    if (!pet) throw new Error('Animal introuvable.')
    return pet
  }

  private memberName(db: DemoDb, memberId: string | undefined): string {
    return db.members.find((m) => m.id === memberId)?.name ?? 'Quelqu’un'
  }

  /** « du matin 🌅 » / « de l’après-midi ☀️ » — article français correct. */
  private slotName(template: { name: string; emoji: string } | undefined): string {
    if (!template) return ''
    const lower = template.name.toLowerCase()
    const article = /^[aeéèiouyh]/.test(lower) ? 'de l’' : 'du '
    return `${article}${lower} ${template.emoji}`
  }

  private slotLabel(db: DemoDb, slotTemplateId: string, date: DateStr): string {
    const t = db.slotTemplates.find((s) => s.id === slotTemplateId)
    const name = t ? `${t.name.toLowerCase()} ${t.emoji}` : 'promenade'
    const day = date === todayStr() ? "d’aujourd’hui" : `du ${formatDayShort(date)}`
    return `la promenade ${day} (${name})`
  }

  private pushSystemMessage(
    db: DemoDb,
    householdId: string,
    text: string,
    extra?: Partial<Pick<Message, 'photo' | 'refDate' | 'refSlotTemplateId'>>,
  ): void {
    db.messages.push({
      id: newId(),
      householdId,
      kind: 'system',
      text,
      createdAt: new Date().toISOString(),
      ...extra,
    })
  }

  private upsertSlot(db: DemoDb, petId: string, date: DateStr, slotTemplateId: string): WalkSlot {
    let slot = db.walkSlots.find(
      (w) => w.petId === petId && w.date === date && w.slotTemplateId === slotTemplateId,
    )
    if (!slot) {
      slot = { id: newId(), petId, date, slotTemplateId, status: 'pending' }
      db.walkSlots.push(slot)
    }
    return slot
  }

  // --- Promenades ----------------------------------------------------------------

  async validateWalk(input: ValidateWalkInput): Promise<void> {
    const session = this.requireSession()
    const db = this.readDb()
    const pet = this.pet(db, session.householdId)
    const slot = this.upsertSlot(db, pet.id, input.date, input.slotTemplateId)
    slot.status = 'done'
    slot.validatedBy = session.memberId
    slot.validatedAt = new Date().toISOString()
    if (input.note) slot.note = input.note
    if (input.photo) slot.photo = input.photo
    const template = db.slotTemplates.find((t) => t.id === input.slotTemplateId)
    this.pushSystemMessage(
      db,
      session.householdId,
      `${this.memberName(db, session.memberId)} a validé la promenade ${this.slotName(template)} ✅`,
      { photo: input.photo, refDate: input.date, refSlotTemplateId: input.slotTemplateId },
    )
    this.writeDb(db)
  }

  async unvalidateWalk(date: DateStr, slotTemplateId: string): Promise<void> {
    const session = this.requireSession()
    const db = this.readDb()
    const pet = this.pet(db, session.householdId)
    const slot = findWalkSlot(
      db.walkSlots.filter((w) => w.petId === pet.id),
      date,
      slotTemplateId,
    )
    if (!slot) return
    slot.status = 'pending'
    slot.validatedBy = undefined
    slot.validatedAt = undefined
    this.writeDb(db)
  }

  async skipWalk(date: DateStr, slotTemplateId: string): Promise<void> {
    const session = this.requireSession()
    const db = this.readDb()
    const pet = this.pet(db, session.householdId)
    const slot = this.upsertSlot(db, pet.id, date, slotTemplateId)
    slot.status = 'skipped'
    slot.validatedBy = session.memberId
    slot.validatedAt = new Date().toISOString()
    this.writeDb(db)
  }

  async attachToWalk(
    date: DateStr,
    slotTemplateId: string,
    patch: { note?: string; photo?: PhotoRef },
  ): Promise<void> {
    const session = this.requireSession()
    const db = this.readDb()
    const pet = this.pet(db, session.householdId)
    const slot = this.upsertSlot(db, pet.id, date, slotTemplateId)
    if (patch.note !== undefined) slot.note = patch.note
    if (patch.photo !== undefined) slot.photo = patch.photo
    this.writeDb(db)
  }

  async assignWalk(date: DateStr, slotTemplateId: string, memberId: string | null): Promise<void> {
    const session = this.requireSession()
    const db = this.readDb()
    const pet = this.pet(db, session.householdId)
    const slot = this.upsertSlot(db, pet.id, date, slotTemplateId)
    slot.assignedMemberId = memberId ?? undefined
    this.writeDb(db)
  }

  async assignWalks(
    assignments: { date: DateStr; slotTemplateId: string; memberId: string }[],
  ): Promise<void> {
    const session = this.requireSession()
    const db = this.readDb()
    const pet = this.pet(db, session.householdId)
    for (const a of assignments) {
      const slot = this.upsertSlot(db, pet.id, a.date, a.slotTemplateId)
      slot.assignedMemberId = a.memberId
    }
    this.writeDb(db)
  }

  /** Créneaux encore existants du foyer — filtre les affectations orphelines. */
  private validTemplateIds(db: DemoDb, householdId: string): Set<string> {
    return new Set(
      db.slotTemplates.filter((t) => t.householdId === householdId).map((t) => t.id),
    )
  }

  async duplicateWeek(fromMonday: DateStr, toMonday: DateStr): Promise<number> {
    const session = this.requireSession()
    const db = this.readDb()
    const pet = this.pet(db, session.householdId)
    const slots = db.walkSlots.filter((w) => w.petId === pet.id)
    const valid = this.validTemplateIds(db, session.householdId)
    const assignments = duplicateWeekAssignments(slots, fromMonday, toMonday).filter((a) =>
      valid.has(a.slotTemplateId),
    )
    for (const a of assignments) {
      const slot = this.upsertSlot(db, pet.id, a.date, a.slotTemplateId)
      slot.assignedMemberId = a.memberId
    }
    this.writeDb(db)
    return assignments.length
  }

  async saveWeekTemplate(monday: DateStr): Promise<void> {
    const session = this.requireSession()
    const db = this.readDb()
    const pet = this.pet(db, session.householdId)
    const slots = db.walkSlots.filter((w) => w.petId === pet.id)
    const template = weekTemplateFromWeek(slots, monday, session.householdId)
    db.weekTemplates = db.weekTemplates.filter((t) => t.householdId !== session.householdId)
    db.weekTemplates.push(template)
    this.writeDb(db)
  }

  async applyWeekTemplate(monday: DateStr): Promise<number> {
    const session = this.requireSession()
    const db = this.readDb()
    const template = db.weekTemplates.find((t) => t.householdId === session.householdId)
    if (!template) throw new Error('Aucune semaine type enregistrée pour le moment.')
    const pet = this.pet(db, session.householdId)
    const valid = this.validTemplateIds(db, session.householdId)
    const assignments = applyTemplateAssignments(template, monday).filter((a) =>
      valid.has(a.slotTemplateId),
    )
    for (const a of assignments) {
      const slot = this.upsertSlot(db, pet.id, a.date, a.slotTemplateId)
      slot.assignedMemberId = a.memberId
    }
    this.writeDb(db)
    return assignments.length
  }

  // --- Gardes -----------------------------------------------------------------

  async upsertCarePeriod(period: Omit<CarePeriod, 'id'> & { id?: string }): Promise<void> {
    const session = this.requireSession()
    const db = this.readDb()
    const pet = this.pet(db, session.householdId)
    const existing = db.carePeriods.filter((c) => c.petId === pet.id)
    const conflicts = carePeriodConflicts(existing, period.startAt, period.endAt, period.id)
    if (conflicts.length > 0) {
      throw new Error(
        `Cette période chevauche la garde de ${this.memberName(db, conflicts[0].memberId)}.`,
      )
    }
    if (period.startAt >= period.endAt) {
      throw new Error('La fin de la garde doit être après son début.')
    }
    const isNew = !period.id
    if (period.id) {
      const idx = db.carePeriods.findIndex((c) => c.id === period.id)
      if (idx >= 0) db.carePeriods[idx] = { ...db.carePeriods[idx], ...period, id: period.id }
    } else {
      db.carePeriods.push({ ...period, id: newId(), petId: pet.id })
    }
    if (isNew) {
      this.pushSystemMessage(
        db,
        session.householdId,
        `${this.memberName(db, period.memberId)} garde ${pet.name} du ${formatInstant(period.startAt)} au ${formatInstant(period.endAt)} 🏡`,
      )
    }
    this.writeDb(db)
  }

  async deleteCarePeriod(id: string): Promise<void> {
    this.requireSession()
    const db = this.readDb()
    db.carePeriods = db.carePeriods.filter((c) => c.id !== id)
    this.writeDb(db)
  }

  // --- Discussion ---------------------------------------------------------------

  async sendMessage(input: SendMessageInput): Promise<void> {
    const session = this.requireSession()
    const db = this.readDb()
    db.messages.push({
      id: newId(),
      householdId: session.householdId,
      authorId: session.memberId,
      kind: 'user',
      text: input.text,
      photo: input.photo,
      refDate: input.refDate,
      refSlotTemplateId: input.refSlotTemplateId,
      createdAt: new Date().toISOString(),
    })
    this.writeDb(db)
  }

  // --- Remplacements ---------------------------------------------------------------

  async createSwapRequest(input: CreateSwapInput): Promise<void> {
    const session = this.requireSession()
    const db = this.readDb()
    const members = db.members.filter((m) => m.householdId === session.householdId)
    const target = nextCascadeTarget(members, session.memberId, [])
    const swap: SwapRequest = {
      id: newId(),
      householdId: session.householdId,
      walkSlotDate: input.walkSlotDate,
      walkSlotTemplateId: input.walkSlotTemplateId,
      carePeriodId: input.carePeriodId,
      requesterId: session.memberId,
      message: input.message,
      status: target ? 'open' : 'exhausted',
      cascade: target ? [{ memberId: target, notifiedAt: new Date().toISOString() }] : [],
      createdAt: new Date().toISOString(),
    }
    db.swapRequests.push(swap)
    const what = this.describeSwapTarget(db, swap)
    this.pushSystemMessage(
      db,
      session.householdId,
      `${this.memberName(db, session.memberId)} cherche un remplaçant pour ${what} 🙏`,
    )
    this.writeDb(db)
  }

  private describeSwapTarget(db: DemoDb, swap: SwapRequest): string {
    if (swap.walkSlotDate && swap.walkSlotTemplateId) {
      return this.slotLabel(db, swap.walkSlotTemplateId, swap.walkSlotDate)
    }
    const period = db.carePeriods.find((c) => c.id === swap.carePeriodId)
    if (period) {
      return `la garde du ${formatInstant(period.startAt)} au ${formatInstant(period.endAt)}`
    }
    return 'sa garde'
  }

  async respondSwap(swapId: string, accept: boolean): Promise<void> {
    const session = this.requireSession()
    const db = this.readDb()
    const swap = db.swapRequests.find((s) => s.id === swapId)
    if (!swap || swap.status === 'accepted' || swap.status === 'cancelled') return
    const now = new Date().toISOString()

    if (accept) {
      swap.status = 'accepted'
      swap.acceptedBy = session.memberId
      swap.resolvedAt = now
      if (swap.walkSlotDate && swap.walkSlotTemplateId) {
        const pet = this.pet(db, session.householdId)
        const slot = this.upsertSlot(db, pet.id, swap.walkSlotDate, swap.walkSlotTemplateId)
        slot.assignedMemberId = session.memberId
      } else if (swap.carePeriodId) {
        const period = db.carePeriods.find((c) => c.id === swap.carePeriodId)
        if (period) period.memberId = session.memberId
      }
      this.pushSystemMessage(
        db,
        session.householdId,
        `${this.memberName(db, session.memberId)} remplace ${this.memberName(db, swap.requesterId)} pour ${this.describeSwapTarget(db, swap)} 🙌`,
      )
      this.writeDb(db)
      return
    }

    // Refus : uniquement si l'appelant est bien la cible courante — sinon
    // (double tap, bannière périmée après escalade) on ignorerait un membre.
    const last = swap.cascade[swap.cascade.length - 1]
    if (!last || last.response || last.memberId !== session.memberId) return
    last.response = 'declined'
    last.respondedAt = now
    const members = db.members.filter((m) => m.householdId === session.householdId)
    const next = nextCascadeTarget(members, swap.requesterId, swap.cascade)
    if (next) {
      swap.cascade.push({ memberId: next, notifiedAt: now })
    } else {
      swap.status = 'exhausted'
      this.pushSystemMessage(
        db,
        session.householdId,
        `Personne n’est disponible pour ${this.describeSwapTarget(db, swap)} pour l’instant — quelqu’un peut aider ? 🆘`,
      )
    }
    this.writeDb(db)
  }

  async cancelSwap(swapId: string): Promise<void> {
    this.requireSession()
    const db = this.readDb()
    const swap = db.swapRequests.find((s) => s.id === swapId)
    if (!swap || swap.status === 'accepted') return
    swap.status = 'cancelled'
    swap.resolvedAt = new Date().toISOString()
    this.writeDb(db)
  }

  // --- Réglages ----------------------------------------------------------------

  async updatePet(patch: Partial<Omit<Pet, 'id' | 'householdId'>>): Promise<void> {
    const session = this.requireSession()
    const db = this.readDb()
    const pet = this.pet(db, session.householdId)
    Object.assign(pet, patch)
    this.writeDb(db)
  }

  async updateMember(
    memberId: string,
    patch: Partial<Pick<Member, 'name' | 'emoji' | 'color'>>,
  ): Promise<void> {
    this.requireSession()
    const db = this.readDb()
    const member = db.members.find((m) => m.id === memberId)
    if (member) Object.assign(member, patch)
    this.writeDb(db)
  }

  async updateMemberPriorities(memberIdsInOrder: string[]): Promise<void> {
    const session = this.requireSession()
    const db = this.readDb()
    const rank = new Map(memberIdsInOrder.map((id, i) => [id, i]))
    for (const m of db.members.filter((m) => m.householdId === session.householdId)) {
      const r = rank.get(m.id)
      if (r !== undefined) m.priorityRank = r
    }
    this.writeDb(db)
  }

  async removeMember(memberId: string): Promise<void> {
    const session = this.requireSession()
    const db = this.readDb()
    const member = db.members.find((m) => m.id === memberId)
    if (!member || member.role === 'owner') return
    db.members = db.members.filter((m) => m.id !== memberId)
    db.prefs = db.prefs.filter((p) => p.memberId !== memberId)
    // Libère ses promenades à venir.
    const today = todayStr()
    for (const slot of db.walkSlots) {
      if (slot.assignedMemberId === memberId && slot.date >= today && slot.status === 'pending') {
        slot.assignedMemberId = undefined
      }
    }
    // Fait avancer les cascades dont il était la cible.
    const members = db.members.filter((m) => m.householdId === session.householdId)
    for (const swap of db.swapRequests.filter((s) => s.status === 'open')) {
      const last = swap.cascade[swap.cascade.length - 1]
      if (last && !last.response && last.memberId === memberId) {
        last.response = 'declined'
        last.respondedAt = new Date().toISOString()
        const next = nextCascadeTarget(members, swap.requesterId, swap.cascade)
        if (next) swap.cascade.push({ memberId: next, notifiedAt: new Date().toISOString() })
        else swap.status = 'exhausted'
      }
    }
    this.writeDb(db)
  }

  async upsertSlotTemplate(template: Omit<SlotTemplate, 'householdId'>): Promise<void> {
    const session = this.requireSession()
    if (!validSlotTimes(template.startTime, template.endTime)) {
      throw new Error('L’heure de fin doit être après l’heure de début.')
    }
    const db = this.readDb()
    const idx = db.slotTemplates.findIndex((t) => t.id === template.id)
    const full: SlotTemplate = { ...template, householdId: session.householdId }
    if (idx >= 0) db.slotTemplates[idx] = full
    else db.slotTemplates.push(full)
    this.writeDb(db)
  }

  async deleteSlotTemplate(id: string): Promise<void> {
    const session = this.requireSession()
    const db = this.readDb()
    // Les lignes en attente n'ont plus de sens sans créneau…
    db.walkSlots = db.walkSlots.filter((w) => !(w.slotTemplateId === id && w.status === 'pending'))
    // …mais les promenades validées restent pour l'historique et la galerie :
    // si le créneau en a, on le désactive au lieu de le supprimer.
    const hasHistory = db.walkSlots.some((w) => w.slotTemplateId === id)
    const template = db.slotTemplates.find(
      (t) => t.id === id && t.householdId === session.householdId,
    )
    if (template && hasHistory) template.active = false
    else {
      db.slotTemplates = db.slotTemplates.filter(
        (t) => !(t.id === id && t.householdId === session.householdId),
      )
    }
    this.writeDb(db)
  }

  async updatePrefs(patch: Partial<Omit<NotificationPrefs, 'memberId'>>): Promise<void> {
    const session = this.requireSession()
    const db = this.readDb()
    let prefs = db.prefs.find((p) => p.memberId === session.memberId)
    if (!prefs) {
      prefs = { memberId: session.memberId, ...DEFAULT_PREFS }
      db.prefs.push(prefs)
    }
    Object.assign(prefs, patch)
    this.writeDb(db)
  }

  // --- Photos ------------------------------------------------------------------

  async updateHousehold(patch: { swapEscalateMinutes?: number }): Promise<void> {
    const session = this.requireSession()
    const db = this.readDb()
    const household = db.households.find((h) => h.id === session.householdId)
    if (household && patch.swapEscalateMinutes !== undefined) {
      household.swapEscalateMinutes = patch.swapEscalateMinutes
    }
    this.writeDb(db)
  }

  async savePhoto(blob: Blob): Promise<PhotoRef> {
    return storeLocalPhoto(blob)
  }

  async savePushSubscription(): Promise<void> {
    // Pas de push en mode démo : les rappels vivent dans l'app.
  }
}
