/**
 * Edge Function « ics » — flux iCal personnel d'un membre.
 *
 * GET /functions/v1/ics?token=<calendar_token>
 *
 * À déployer SANS vérification de JWT (supabase functions deploy ics
 * --no-verify-jwt) : Google Calendar et consorts n'envoient aucun en-tête.
 * L'authentification repose sur le jeton secret `calendar_token` du membre
 * (uuid non devinable, régénérable en supprimant/recréant le membre).
 *
 * Contenu : les gardes du membre + ses promenades assignées, de J−7 à J+60,
 * aux horaires des créneaux du foyer (fuseau APP_TZ, converti en UTC).
 */
import { createClient } from 'npm:@supabase/supabase-js@2'

const TZ = Deno.env.get('APP_TZ') ?? 'Europe/Paris'

const db = createClient(
  Deno.env.get('SUPABASE_URL') ?? '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  { auth: { persistSession: false } },
)

// --- Dates et fuseaux -----------------------------------------------------------

/** Composantes d'un instant, lues dans le fuseau APP_TZ. */
function partsInTz(d: Date): { y: number; mo: number; d: number; h: number; mi: number } {
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
  return { y: Number(p.year), mo: Number(p.month), d: Number(p.day), h: Number(p.hour), mi: Number(p.minute) }
}

/**
 * Convertit « date + heure locales dans APP_TZ » en instant UTC.
 * Deux itérations de correction suffisent, y compris autour des
 * changements d'heure été/hiver.
 */
function zonedToUtc(dateStr: string, timeStr: string): Date {
  const [y, mo, d] = dateStr.split('-').map(Number)
  const [h, mi] = timeStr.split(':').map(Number)
  const wanted = Date.UTC(y, mo - 1, d, h, mi)
  let ts = wanted
  for (let i = 0; i < 2; i++) {
    const p = partsInTz(new Date(ts))
    const seen = Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi)
    ts += wanted - seen
  }
  return new Date(ts)
}

/** Date locale du jour (YYYY-MM-DD) dans APP_TZ. */
function todayLocal(): string {
  const p = partsInTz(new Date())
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${p.y}-${pad(p.mo)}-${pad(p.d)}`
}

/** Décale une date calendaire de `days` jours (arithmétique UTC, sans DST). */
function shiftDate(dateStr: string, days: number): string {
  const [y, mo, d] = dateStr.split('-').map(Number)
  const shifted = new Date(Date.UTC(y, mo - 1, d + days))
  return shifted.toISOString().slice(0, 10)
}

// --- Format ICS -----------------------------------------------------------------

/** Instant UTC au format ICS : 20260712T170000Z. */
function icsUtc(d: Date): string {
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
}

/** Échappe le texte selon la RFC 5545 (\\ ; , et retours à la ligne). */
function icsEscape(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n')
}

/**
 * Plie une ligne à ≤ 74 octets (RFC 5545) en itérant par points de code :
 * un émoji ou un accent n'est jamais coupé au milieu de sa séquence.
 */
function icsFold(line: string): string[] {
  const encoder = new TextEncoder()
  const out: string[] = []
  let current = ''
  let bytes = 0
  for (const ch of line) {
    const b = encoder.encode(ch).length
    const max = out.length === 0 ? 74 : 73 // les suites portent un espace en tête
    if (bytes + b > max) {
      out.push(out.length === 0 ? current : ' ' + current)
      current = ch
      bytes = b
    } else {
      current += ch
      bytes += b
    }
  }
  out.push(out.length === 0 ? current : ' ' + current)
  return out
}

interface IcsEvent {
  uid: string
  start: Date
  end: Date
  summary: string
  description?: string
}

function buildCalendar(name: string, events: IcsEvent[]): string {
  const stamp = icsUtc(new Date())
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Dogagenda//Flux personnel//FR',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${icsEscape(name)}`,
    `X-WR-TIMEZONE:${TZ}`,
  ]
  for (const ev of events) {
    lines.push(
      'BEGIN:VEVENT',
      `UID:${ev.uid}`,
      `DTSTAMP:${stamp}`,
      `DTSTART:${icsUtc(ev.start)}`,
      `DTEND:${icsUtc(ev.end)}`,
      `SUMMARY:${icsEscape(ev.summary)}`,
    )
    if (ev.description) lines.push(`DESCRIPTION:${icsEscape(ev.description)}`)
    lines.push('END:VEVENT')
  }
  lines.push('END:VCALENDAR')
  // La RFC 5545 impose des fins de ligne CRLF et des lignes pliées à 75 octets.
  return lines.flatMap(icsFold).join('\r\n') + '\r\n'
}

// --- Point d'entrée ---------------------------------------------------------------

const notFound = () => new Response('Introuvable', { status: 404 })

Deno.serve(async (req) => {
  if (req.method !== 'GET') {
    return new Response('Méthode non autorisée', { status: 405 })
  }
  const token = new URL(req.url).searchParams.get('token') ?? ''
  // Le paramètre doit être un uuid : évite une erreur Postgres sur un cast invalide.
  if (!/^[0-9a-f-]{36}$/i.test(token)) return notFound()

  const { data: memberRows } = await db
    .from('members')
    .select('id, household_id, name')
    .eq('calendar_token', token)
    .limit(1)
  const member = memberRows?.[0]
  if (!member) return notFound()

  // Le foyer, ses animaux et ses créneaux.
  const [petsQ, templatesQ] = await Promise.all([
    db.from('pets').select('id, name').eq('household_id', member.household_id),
    db.from('slot_templates').select('id, name, emoji, start_time, end_time').eq('household_id', member.household_id),
  ])
  const pets = petsQ.data ?? []
  const petIds = pets.map((p) => p.id)
  const petName = new Map(pets.map((p) => [p.id, p.name]))
  const templateById = new Map((templatesQ.data ?? []).map((t) => [t.id, t]))

  // Fenêtre de J−7 à J+60 : assez d'historique pour le contexte,
  // assez d'avenir pour la planification.
  const today = todayLocal()
  const from = shiftDate(today, -7)
  const to = shiftDate(today, 60)
  const fromIso = zonedToUtc(from, '00:00').toISOString()
  const toIso = zonedToUtc(to, '23:59').toISOString()

  const [periodsQ, walksQ] = await Promise.all([
    // Gardes du membre chevauchant la fenêtre.
    db
      .from('care_periods')
      .select('id, pet_id, start_at, end_at')
      .in('pet_id', petIds.length > 0 ? petIds : ['00000000-0000-0000-0000-000000000000'])
      .eq('member_id', member.id)
      .gte('end_at', fromIso)
      .lte('start_at', toIso),
    // Promenades assignées au membre dans la fenêtre (les annulées sont exclues).
    db
      .from('walk_slots')
      .select('id, pet_id, date, slot_template_id, status')
      .in('pet_id', petIds.length > 0 ? petIds : ['00000000-0000-0000-0000-000000000000'])
      .eq('assigned_member_id', member.id)
      .neq('status', 'skipped')
      .gte('date', from)
      .lte('date', to),
  ])

  const events: IcsEvent[] = []

  for (const p of periodsQ.data ?? []) {
    events.push({
      uid: `care-${p.id}@dogagenda`,
      start: new Date(p.start_at),
      end: new Date(p.end_at),
      summary: `🏡 Garde de ${petName.get(p.pet_id) ?? 'mon chien'}`,
      description: `${member.name} garde ${petName.get(p.pet_id) ?? 'le chien'} sur cette période (Dogagenda).`,
    })
  }

  for (const w of walksQ.data ?? []) {
    const tpl = templateById.get(w.slot_template_id)
    if (!tpl) continue // créneau supprimé depuis
    events.push({
      uid: `walk-${w.id}@dogagenda`,
      start: zonedToUtc(w.date, tpl.start_time.slice(0, 5)),
      end: zonedToUtc(w.date, tpl.end_time.slice(0, 5)),
      summary: `🐾 Promenade de ${petName.get(w.pet_id) ?? 'mon chien'} — ${tpl.name}`,
      description: `Créneau ${tpl.name} ${tpl.emoji} assigné à ${member.name} (Dogagenda).`,
    })
  }

  events.sort((a, b) => a.start.getTime() - b.start.getTime())

  const body = buildCalendar(`Dogagenda — ${member.name}`, events)
  return new Response(body, {
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': 'inline; filename="dogagenda.ics"',
      // Les agrégateurs de calendriers rafraîchissent d'eux-mêmes ;
      // un petit cache évite de marteler la base.
      'Cache-Control': 'public, max-age=300',
    },
  })
})
