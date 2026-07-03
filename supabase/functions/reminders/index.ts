/**
 * Edge Function « reminders » — invoquée toutes les 5 minutes par pg_cron
 * (voir docs/SUPABASE.md). Elle parcourt tous les foyers et envoie les
 * notifications push :
 *
 *   (a) rappel avant créneau, selon l'anticipation choisie par le membre ;
 *   (b) créneau manqué : promeneur assigné 5 min après la fin, puis tout
 *       le foyer 45 min après ;
 *   (c) rappel de garde la veille (période commençant dans 20 à 28 h) ;
 *   (d) escalade des cascades de remplacement sans réponse depuis 30 min.
 *
 * Chaque envoi respecte les préférences du membre (types actifs, heures de
 * silence — y compris à cheval sur minuit) et est dédupliqué via la table
 * reminder_log, donc la fonction est idempotente : la relancer ne spamme pas.
 */
import { createClient } from 'npm:@supabase/supabase-js@2'
import { sendPush, type PushPayload } from '../_shared/push.ts'

const TZ = Deno.env.get('APP_TZ') ?? 'Europe/Paris'
/** Délai sans réponse avant de passer à la personne suivante de la cascade. */
const SWAP_ESCALATE_MINUTES = 30

const db = createClient(
  Deno.env.get('SUPABASE_URL') ?? '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  { auth: { persistSession: false } },
)

// --- Types (miroir minimal des tables) ---------------------------------------

interface MemberRow {
  id: string
  household_id: string
  name: string
  role: string
  priority_rank: number
  push_subscription: unknown
  created_at: string
}
interface PrefsRow {
  member_id: string
  walk_reminder: boolean
  missed_walk: boolean
  care_reminder: boolean
  swaps: boolean
  chat: boolean
  lead_minutes: number
  quiet_start: string | null
  quiet_end: string | null
}
interface TemplateRow {
  id: string
  household_id: string
  name: string
  emoji: string
  start_time: string
  end_time: string
  active: boolean
}
interface PetRow {
  id: string
  household_id: string
  name: string
}
interface WalkSlotRow {
  id: string
  pet_id: string
  date: string
  slot_template_id: string
  assigned_member_id: string | null
  status: string
}
interface CarePeriodRow {
  id: string
  pet_id: string
  member_id: string
  start_at: string
}
interface CascadeStep {
  memberId: string
  notifiedAt: string
  response?: string
  respondedAt?: string
}
interface SwapRow {
  id: string
  household_id: string
  walk_slot_date: string | null
  walk_slot_template_id: string | null
  care_period_id: string | null
  requester_id: string
  message: string | null
  cascade: CascadeStep[]
}

type PrefKind = 'walk_reminder' | 'missed_walk' | 'care_reminder' | 'swaps'

const DEFAULT_PREFS: Omit<PrefsRow, 'member_id'> = {
  walk_reminder: true,
  missed_walk: true,
  care_reminder: true,
  swaps: true,
  chat: true,
  lead_minutes: 30,
  quiet_start: null,
  quiet_end: null,
}

// --- Heure locale du foyer ----------------------------------------------------

/** Date (YYYY-MM-DD) et minutes écoulées depuis minuit, dans le fuseau APP_TZ. */
function localParts(d: Date): { date: string; minutes: number } {
  const fmt = new Intl.DateTimeFormat('fr-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  })
  const p = Object.fromEntries(fmt.formatToParts(d).map((x) => [x.type, x.value]))
  return {
    date: `${p.year}-${p.month}-${p.day}`,
    minutes: Number(p.hour) * 60 + Number(p.minute),
  }
}

/** « 07:00:00 » ou « 07:00 » → minutes depuis minuit. */
function toMinutes(t: string): number {
  const [h, m] = t.split(':')
  return Number(h) * 60 + Number(m)
}

/** « 19:00 » → « 19h », « 18:30 » → « 18h30 » (convention française). */
function frTime(t: string): string {
  const [h, m] = t.split(':')
  return m === '00' ? `${Number(h)}h` : `${Number(h)}h${m}`
}

/** Heure locale d'un instant ISO, au format « 18h30 ». */
function frTimeOfInstant(iso: string): string {
  const fmt = new Intl.DateTimeFormat('fr-FR', {
    timeZone: TZ,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  })
  const p = Object.fromEntries(fmt.formatToParts(new Date(iso)).map((x) => [x.type, x.value]))
  return frTime(`${p.hour}:${p.minute}`)
}

/** « 2026-07-12 » → « 12/07 ». */
function frDate(dateStr: string): string {
  const [, m, d] = dateStr.split('-')
  return `${d}/${m}`
}

/**
 * Vrai si `minutes` tombe dans les heures de silence du membre.
 * Gère les plages à cheval sur minuit (ex. 22:00 → 07:30).
 */
function inQuietHours(prefs: Omit<PrefsRow, 'member_id'>, minutes: number): boolean {
  if (!prefs.quiet_start || !prefs.quiet_end) return false
  const start = toMinutes(prefs.quiet_start)
  const end = toMinutes(prefs.quiet_end)
  if (start === end) return false
  if (start < end) return minutes >= start && minutes < end
  return minutes >= start || minutes < end // plage nocturne
}

// --- Point d'entrée -------------------------------------------------------------

Deno.serve(async () => {
  const now = new Date()
  const { date: today, minutes: nowMin } = localParts(now)
  let sent = 0

  // Chargement global : à l'échelle de foyers familiaux, tout tient en mémoire.
  const [membersQ, prefsQ, templatesQ, petsQ, slotsQ] = await Promise.all([
    db.from('members').select('*'),
    db.from('notification_prefs').select('*'),
    db.from('slot_templates').select('*').eq('active', true),
    db.from('pets').select('id, household_id, name'),
    db.from('walk_slots').select('*').eq('date', today),
  ])
  const members = (membersQ.data ?? []) as MemberRow[]
  const prefsRows = (prefsQ.data ?? []) as PrefsRow[]
  const templates = (templatesQ.data ?? []) as TemplateRow[]
  const pets = (petsQ.data ?? []) as PetRow[]
  const todaySlots = (slotsQ.data ?? []) as WalkSlotRow[]

  const memberById = new Map(members.map((m) => [m.id, m]))
  const petById = new Map(pets.map((p) => [p.id, p]))
  const petByHousehold = new Map(pets.map((p) => [p.household_id, p]))
  const prefsByMember = new Map(prefsRows.map((p) => [p.member_id, p]))
  const slotByTemplate = new Map(todaySlots.map((s) => [s.slot_template_id, s]))

  const prefsFor = (memberId: string): Omit<PrefsRow, 'member_id'> =>
    prefsByMember.get(memberId) ?? DEFAULT_PREFS

  /** Le membre veut-il recevoir ce type de notification, maintenant ? */
  const canReceive = (memberId: string, kind: PrefKind): boolean => {
    const p = prefsFor(memberId)
    return p[kind] && !inQuietHours(p, nowMin)
  }

  /**
   * Déduplication : tente d'insérer la clé dans reminder_log.
   * Un doublon (clé déjà présente) signifie « déjà envoyé ».
   */
  const alreadySent = async (key: string): Promise<boolean> => {
    const { error } = await db.from('reminder_log').insert({ key })
    return error !== null
  }

  /**
   * Envoie la notification ; en cas d'échec, l'abonnement est très
   * probablement expiré (404/410) : on le nettoie pour que l'app
   * propose au membre de réactiver les notifications.
   */
  const notify = async (member: MemberRow, payload: PushPayload): Promise<void> => {
    if (!member.push_subscription) return
    const ok = await sendPush(member.push_subscription, payload)
    if (ok) {
      sent++
    } else {
      await db.from('members').update({ push_subscription: null }).eq('id', member.id)
    }
  }

  // ---------------------------------------------------------------------------
  // (a) Rappel avant créneau : le début tombe dans [maintenant, maintenant + délai]
  // ---------------------------------------------------------------------------
  for (const tpl of templates) {
    const slot = slotByTemplate.get(tpl.id)
    if (!slot || slot.status !== 'pending' || !slot.assigned_member_id) continue
    const member = memberById.get(slot.assigned_member_id)
    if (!member) continue
    const startMin = toMinutes(tpl.start_time)
    const lead = prefsFor(member.id).lead_minutes
    if (startMin < nowMin || startMin > nowMin + lead) continue
    if (!canReceive(member.id, 'walk_reminder')) continue
    const key = `pre:${tpl.id}:${today}:${member.id}`
    if (await alreadySent(key)) continue
    const pet = petById.get(slot.pet_id)
    await notify(member, {
      title: `Bientôt la promenade ${tpl.emoji}`,
      body: `${member.name}, c’est ton créneau ${tpl.name.toLowerCase()} pour ${pet?.name ?? 'le chien'} à ${frTime(tpl.start_time.slice(0, 5))} !`,
      tag: 'walk-reminder',
      url: '/',
    })
  }

  // ---------------------------------------------------------------------------
  // (b) Créneau manqué : toujours en attente après la fin du créneau
  // ---------------------------------------------------------------------------
  for (const tpl of templates) {
    const endMin = toMinutes(tpl.end_time)
    if (nowMin < endMin + 5) continue
    const slot = slotByTemplate.get(tpl.id)
    // Pas de ligne = créneau implicitement en attente (mais sans assigné).
    if (slot && slot.status !== 'pending') continue
    const pet = petByHousehold.get(tpl.household_id)
    const petName = pet?.name ?? 'le chien'

    // 1er rappel (fin + 5 min) : le promeneur assigné.
    if (slot?.assigned_member_id) {
      const member = memberById.get(slot.assigned_member_id)
      if (member && canReceive(member.id, 'missed_walk')) {
        const key = `missed:${tpl.id}:${today}:${member.id}`
        if (!(await alreadySent(key))) {
          await notify(member, {
            title: `La promenade ${tpl.name.toLowerCase()} attend ${tpl.emoji}`,
            body: `${petName} n’a pas encore été promené — un petit tour ?`,
            tag: 'missed-walk',
            url: '/',
          })
        }
      }
    }

    // 2e rappel (fin + 45 min) : tout le foyer.
    if (nowMin >= endMin + 45) {
      const household = members.filter((m) => m.household_id === tpl.household_id)
      for (const member of household) {
        if (!canReceive(member.id, 'missed_walk')) continue
        const key = `missed2:${tpl.id}:${today}:${member.id}`
        if (await alreadySent(key)) continue
        await notify(member, {
          title: `${petName} attend toujours 👀`,
          body: `La promenade ${tpl.name.toLowerCase()} n’a pas été validée. Quelqu’un peut y aller ?`,
          tag: 'missed-walk',
          url: '/',
        })
      }
    }
  }

  // ---------------------------------------------------------------------------
  // (c) Rappel de garde : période commençant dans 20 à 28 heures (≈ la veille)
  // ---------------------------------------------------------------------------
  const in20h = new Date(now.getTime() + 20 * 3600_000).toISOString()
  const in28h = new Date(now.getTime() + 28 * 3600_000).toISOString()
  const { data: periods } = await db
    .from('care_periods')
    .select('id, pet_id, member_id, start_at')
    .gte('start_at', in20h)
    .lte('start_at', in28h)
  for (const period of (periods ?? []) as CarePeriodRow[]) {
    const member = memberById.get(period.member_id)
    if (!member || !canReceive(member.id, 'care_reminder')) continue
    const key = `care:${period.id}`
    if (await alreadySent(key)) continue
    const pet = petById.get(period.pet_id)
    await notify(member, {
      title: 'À toi la garde 🏡',
      body: `C’est toi qui gardes ${pet?.name ?? 'le chien'} à partir de demain ${frTimeOfInstant(period.start_at)}.`,
      tag: 'care-reminder',
      url: '/planning',
    })
  }

  // ---------------------------------------------------------------------------
  // (d) Escalade des remplacements : cible silencieuse depuis plus de 30 min
  // ---------------------------------------------------------------------------
  const { data: swapsData } = await db.from('swap_requests').select('*').eq('status', 'open')
  const staleBefore = now.getTime() - SWAP_ESCALATE_MINUTES * 60_000
  for (const swap of (swapsData ?? []) as SwapRow[]) {
    const cascade: CascadeStep[] = Array.isArray(swap.cascade) ? swap.cascade : []
    const last = cascade[cascade.length - 1]
    if (!last || last.response) continue
    if (Date.parse(last.notifiedAt) >= staleBefore) continue

    // Silence vaut refus : on marque le maillon puis on passe au suivant
    // (même logique que le RPC respond_swap en cas de refus).
    last.response = 'declined'
    last.respondedAt = now.toISOString()
    const already = new Set(cascade.map((s) => s.memberId))
    const next = members
      .filter(
        (m) =>
          m.household_id === swap.household_id &&
          m.id !== swap.requester_id &&
          m.role !== 'guest' &&
          !already.has(m.id),
      )
      .sort(
        (a, b) => a.priority_rank - b.priority_rank || a.created_at.localeCompare(b.created_at),
      )[0]

    const requester = memberById.get(swap.requester_id)
    const label = swap.walk_slot_date
      ? `la promenade du ${frDate(swap.walk_slot_date)}`
      : 'sa garde'

    if (next) {
      cascade.push({ memberId: next.id, notifiedAt: now.toISOString() })
      const { error } = await db.from('swap_requests').update({ cascade }).eq('id', swap.id)
      if (error) continue
      if (canReceive(next.id, 'swaps')) {
        await notify(next, {
          title: 'Un coup de patte ? 🙏',
          body: `${requester?.name ?? 'Quelqu’un'} cherche un remplaçant pour ${label}.${swap.message ? ` « ${swap.message} »` : ''}`,
          tag: 'swap-request',
          url: '/',
        })
      }
    } else {
      // Liste épuisée : la demande reste ouverte à tous + message SOS dans le fil.
      const { error } = await db
        .from('swap_requests')
        .update({ cascade, status: 'exhausted' })
        .eq('id', swap.id)
      if (error) continue
      await db.from('messages').insert({
        household_id: swap.household_id,
        kind: 'system',
        text: `Personne n’est disponible pour ${label} pour l’instant — quelqu’un peut aider ? 🆘`,
      })
    }
  }

  return new Response(JSON.stringify({ ok: true, sent }), {
    headers: { 'Content-Type': 'application/json' },
  })
})
