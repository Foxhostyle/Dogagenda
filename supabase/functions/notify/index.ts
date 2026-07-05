/**
 * Push immédiats, déclenchés par l'application juste après une action :
 *  - `swap-created` / `swap-advanced` : pousse vers la cible courante de la
 *    cascade (ou vers tout le foyer si la demande est épuisée) ;
 *  - `swap-accepted` : prévient le demandeur que quelqu'un a accepté ;
 *  - `message-sent` : « nouveau message » aux membres qui l'ont activé.
 *
 * L'appelant doit être un membre authentifié du foyer concerné (vérifié via
 * son JWT). La déduplication passe par reminder_log — le cron `reminders`
 * sert de filet de sécurité si cet appel échoue.
 *
 * Déploiement : supabase functions deploy notify
 */
import { createClient } from 'npm:@supabase/supabase-js@2'
import { sendPush, type PushPayload } from '../_shared/push.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
const TZ = Deno.env.get('APP_TZ') ?? 'Europe/Paris'

const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

interface MemberRow {
  id: string
  household_id: string
  name: string
  push_subscription: unknown
}

interface PrefsRow {
  member_id: string
  swaps: boolean
  chat: boolean
  quiet_start: string | null
  quiet_end: string | null
}

interface CascadeStep {
  memberId: string
  notifiedAt: string
  response?: string
}

interface SwapRow {
  id: string
  household_id: string
  requester_id: string
  walk_slot_date: string | null
  care_period_id: string | null
  message: string | null
  status: string
  accepted_by: string | null
  cascade: CascadeStep[]
}

/** Minutes locales (fuseau du foyer) pour les heures de silence. */
function localMinutes(d: Date): number {
  const fmt = new Intl.DateTimeFormat('fr-FR', {
    timeZone: TZ,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  })
  const p = Object.fromEntries(fmt.formatToParts(d).map((x) => [x.type, x.value]))
  return Number(p.hour) * 60 + Number(p.minute)
}

function toMinutes(t: string): number {
  const [h, m] = t.split(':')
  return Number(h) * 60 + Number(m)
}

function inQuietHours(prefs: PrefsRow | undefined, nowMin: number): boolean {
  if (!prefs?.quiet_start || !prefs?.quiet_end) return false
  const start = toMinutes(prefs.quiet_start)
  const end = toMinutes(prefs.quiet_end)
  // Plage pouvant traverser minuit (ex. 22:00 → 07:00).
  return start <= end ? nowMin >= start && nowMin < end : nowMin >= start || nowMin < end
}

function frDate(dateStr: string): string {
  const [, m, d] = dateStr.split('-')
  return `${Number(d)}/${m}`
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('Méthode non autorisée', { status: 405 })
  const body = (await req.json().catch(() => null)) as Record<string, string> | null
  if (!body?.type) return new Response('Requête invalide', { status: 400 })

  // --- Qui appelle ? Doit être un membre authentifié. -------------------------
  const authClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
  })
  const { data: userData } = await authClient.auth.getUser()
  if (!userData?.user) return new Response('Non authentifié', { status: 401 })
  const { data: callerRows } = await db
    .from('members')
    .select('id, household_id')
    .eq('user_id', userData.user.id)
  const callerMemberships = new Set((callerRows ?? []).map((m) => m.household_id))

  const nowMin = localMinutes(new Date())
  let sent = 0

  const loadHousehold = async (householdId: string) => {
    const [membersQ, prefsQ] = await Promise.all([
      db.from('members').select('id, household_id, name, push_subscription').eq('household_id', householdId),
      db.from('notification_prefs').select('*'),
    ])
    const members = (membersQ.data ?? []) as MemberRow[]
    const prefs = new Map(((prefsQ.data ?? []) as PrefsRow[]).map((p) => [p.member_id, p]))
    return { members, prefs }
  }

  const push = async (
    member: MemberRow | undefined,
    prefs: Map<string, PrefsRow>,
    kind: 'swaps' | 'chat',
    payload: PushPayload,
    dedupeKey?: string,
  ): Promise<void> => {
    if (!member?.push_subscription) return
    const p = prefs.get(member.id)
    if (p && !p[kind]) return
    if (inQuietHours(p, nowMin)) return
    if (dedupeKey) {
      const { error } = await db.from('reminder_log').insert({ key: dedupeKey })
      if (error) return // déjà envoyé
    }
    const ok = await sendPush(member.push_subscription, payload)
    if (ok) sent++
    else await db.from('members').update({ push_subscription: null }).eq('id', member.id)
  }

  // --- Remplacements ------------------------------------------------------------
  if (body.type === 'swap-created' || body.type === 'swap-advanced' || body.type === 'swap-accepted') {
    const { data: swapRows } = await db.from('swap_requests').select('*').eq('id', body.swapId)
    const swap = swapRows?.[0] as SwapRow | undefined
    if (!swap) return new Response('Demande introuvable', { status: 404 })
    if (!callerMemberships.has(swap.household_id)) {
      return new Response('Hors de ton foyer', { status: 403 })
    }
    const { members, prefs } = await loadHousehold(swap.household_id)
    const byId = new Map(members.map((m) => [m.id, m]))
    const requesterName = byId.get(swap.requester_id)?.name ?? 'Quelqu’un'
    const label = swap.walk_slot_date
      ? `la promenade du ${frDate(swap.walk_slot_date)}`
      : 'sa garde'

    if (body.type === 'swap-accepted' && swap.status === 'accepted') {
      await push(
        byId.get(swap.requester_id),
        prefs,
        'swaps',
        {
          title: 'Remplacement trouvé 🙌',
          body: `${byId.get(swap.accepted_by ?? '')?.name ?? 'Quelqu’un'} s’occupe de ${label}.`,
          tag: 'swap-accepted',
          url: '/aujourdhui',
        },
        `swap-accepted:${swap.id}`,
      )
    } else if (swap.status === 'open') {
      const last = swap.cascade[swap.cascade.length - 1]
      if (last && !last.response) {
        await push(
          byId.get(last.memberId),
          prefs,
          'swaps',
          {
            title: 'Un coup de patte ? 🙏',
            body: `${requesterName} cherche un remplaçant pour ${label}.${swap.message ? ` « ${swap.message} »` : ''}`,
            tag: 'swap-request',
            url: '/aujourdhui',
            swapId: swap.id,
          },
          `swap:${swap.id}:${last.memberId}`,
        )
      }
    } else if (swap.status === 'exhausted') {
      for (const member of members) {
        if (member.id === swap.requester_id) continue
        await push(
          member,
          prefs,
          'swaps',
          {
            title: 'SOS promenade 🆘',
            body: `Personne n’est disponible pour ${label} — tu peux aider ?`,
            tag: 'swap-request',
            url: '/aujourdhui',
            swapId: swap.id,
          },
          `swap-sos:${swap.id}:${member.id}`,
        )
      }
    }
  }

  // --- Nouveau message dans la discussion ------------------------------------------
  if (body.type === 'message-sent') {
    const householdId = body.householdId
    if (!householdId || !callerMemberships.has(householdId)) {
      return new Response('Hors de ton foyer', { status: 403 })
    }
    const { members, prefs } = await loadHousehold(householdId)
    const author = members.find((m) => m.id === body.authorMemberId)
    // Message privé : seul le destinataire est prévenu.
    const recipientId = body.recipientId || null
    for (const member of members) {
      if (member.id === body.authorMemberId) continue
      if (recipientId && member.id !== recipientId) continue
      await push(member, prefs, 'chat', {
        title: `${author?.name ?? 'Message'} 💬${recipientId ? ' (privé)' : ''}`,
        body: body.preview || 'Nouveau message',
        tag: 'chat',
        url: '/discussion',
      })
    }
  }

  return new Response(JSON.stringify({ ok: true, sent }), {
    headers: { 'Content-Type': 'application/json' },
  })
})
