import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import {
  CalendarPlus,
  Check,
  ChevronRight,
  Clock,
  HandHeart,
  MessageCircle,
  MoreHorizontal,
  Undo2,
  UserRound,
} from 'lucide-react'
import MemberPicker from '../components/MemberPicker'
import PhotoInput from '../components/PhotoInput'
import {
  Avatar,
  Button,
  Card,
  EmptyState,
  MemberTag,
  PawBurst,
  SectionTitle,
  Sheet,
  TextArea,
  cx,
} from '../components/ui'
import { provider } from '../data'
import {
  activeCarePeriod,
  daySlotViews,
  exhaustedSwaps,
  nextCarePeriod,
  nextCascadeTarget,
  swapsTargeting,
  type DaySlotView,
} from '../domain/logic'
import type { AppSnapshot, Member, PhotoRef, SwapRequest } from '../domain/types'
import { atTime, formatDayLong, formatInstant, formatTime, todayStr, type DateStr } from '../lib/dates'
import { buildSingleEventIcs } from '../lib/ics'
import { usePhotoUrl } from '../lib/photos'
import { memberById, useActiveMember, useApp } from '../store/useApp'
import { tryAction, useToasts } from '../store/useToasts'

/** Libellé humain de la cible d'une demande de remplacement. */
function describeSwap(snap: AppSnapshot, swap: SwapRequest): string {
  if (swap.walkSlotDate && swap.walkSlotTemplateId) {
    const t = snap.slotTemplates.find((t) => t.id === swap.walkSlotTemplateId)
    const day =
      swap.walkSlotDate === todayStr() ? "aujourd'hui" : `le ${formatDayLong(swap.walkSlotDate)}`
    return `la promenade ${t ? `${t.name.toLowerCase()} ${t.emoji}` : ''} ${day}`
  }
  const p = snap.carePeriods.find((c) => c.id === swap.carePeriodId)
  if (p) return `la garde du ${formatInstant(p.startAt)} au ${formatInstant(p.endAt)}`
  return 'sa garde'
}

export default function Today() {
  const { snap, tick } = useApp()
  const me = useActiveMember()
  void tick // recalcul des statuts chaque minute
  const [burstKey, setBurstKey] = useState(0)
  const [searchParams, setSearchParams] = useSearchParams()
  const toast = useToasts((s) => s.push)

  // Réponse à une demande depuis les boutons de la notification push
  // (le service worker ouvre /aujourdhui?swap=…&action=accept|decline).
  useEffect(() => {
    const swapId = searchParams.get('swap')
    const action = searchParams.get('action')
    if (!swapId || !action) return
    setSearchParams({}, { replace: true })
    void tryAction(async () => {
      await provider.respondSwap(swapId, action === 'accept')
      toast(action === 'accept' ? 'Merci, c’est noté !' : 'Refus transmis', action === 'accept' ? '🙌' : '👌')
    })
  }, [searchParams, setSearchParams, toast])

  if (!snap || !me) return null
  const now = new Date()
  const today = todayStr(now)
  const views = daySlotViews(snap.slotTemplates, snap.walkSlots, today, now)

  return (
    <div className="animate-fade">
      <TodayHeader snap={snap} today={today} />
      <SwapBanners snap={snap} me={me} />
      <CareCard snap={snap} me={me} now={now} />
      <SectionTitle>Les promenades du jour</SectionTitle>
      {views.length === 0 ? (
        <EmptyState
          emoji="🦴"
          title="Aucun créneau de promenade défini"
          text={`Configure les créneaux du foyer dans l’onglet ${snap.pet.name}.`}
        />
      ) : (
        <div className="flex flex-col gap-3">
          {views.map((v) => (
            <SlotCard
              key={v.template.id}
              view={v}
              date={today}
              snap={snap}
              me={me}
              onValidated={() => setBurstKey(Date.now())}
            />
          ))}
        </div>
      )}
      <PawBurst burstKey={burstKey} />
    </div>
  )
}

function TodayHeader({ snap, today }: { snap: AppSnapshot; today: DateStr }) {
  const photoUrl = usePhotoUrl(snap.pet.photo)
  return (
    <header className="flex items-center gap-4 pt-6 pb-2">
      {photoUrl ? (
        <img
          src={photoUrl}
          alt={snap.pet.name}
          className="size-16 rounded-full object-cover ring-4 ring-sage-200 dark:ring-sage-900"
        />
      ) : (
        <span className="flex size-16 items-center justify-center rounded-full bg-sage-100 text-4xl ring-4 ring-sage-200 dark:bg-sage-900/60 dark:ring-sage-900">
          🐕
        </span>
      )}
      <div>
        <h1 className="text-2xl font-black tracking-tight">{snap.pet.name}</h1>
        <p className="text-sm font-semibold text-bark-500 first-letter:uppercase dark:text-bark-400">
          {formatDayLong(today)}
        </p>
      </div>
    </header>
  )
}

// ---------------------------------------------------------------------------
// Garde en cours
// ---------------------------------------------------------------------------

function CareCard({ snap, me, now }: { snap: AppSnapshot; me: Member; now: Date }) {
  const navigate = useNavigate()
  const toast = useToasts((s) => s.push)
  const care = activeCarePeriod(snap.carePeriods, now)
  const next = nextCarePeriod(snap.carePeriods, now)
  const [confirmRelay, setConfirmRelay] = useState(false)

  if (!care) {
    return (
      <Card className="mt-2 flex items-center gap-3" onClick={() => navigate('/planning')}>
        <span className="text-3xl" aria-hidden>
          🏡
        </span>
        <div className="flex-1">
          <p className="font-bold">Personne ne garde {snap.pet.name} en ce moment</p>
          <p className="text-sm text-bark-500 dark:text-bark-400">
            {next
              ? `Prochaine garde : ${memberById(snap, next.memberId)?.name} dès ${formatInstant(next.startAt)}`
              : 'Ajoute une période de garde dans le planning.'}
          </p>
        </div>
        <ChevronRight className="size-5 text-bark-400" aria-hidden />
      </Card>
    )
  }

  const keeper = memberById(snap, care.memberId)
  const relayTarget = nextCascadeTarget(snap.members, me.id, [])
  // Une seule demande de relais à la fois pour une même garde.
  const hasOpenRelay = snap.swapRequests.some(
    (s) => s.carePeriodId === care.id && (s.status === 'open' || s.status === 'exhausted'),
  )

  return (
    <Card className="mt-2">
      <div className="flex items-center gap-3">
        <Avatar member={keeper} size="lg" />
        <div className="flex-1">
          <p className="text-lg font-extrabold">
            {keeper?.name ?? 'Quelqu’un'} garde {snap.pet.name}
          </p>
          <p className="text-sm font-semibold text-bark-500 dark:text-bark-400">
            jusqu’à {formatInstant(care.endAt, now)}
            {next && memberById(snap, next.memberId) && (
              <> · ensuite {memberById(snap, next.memberId)?.name}</>
            )}
          </p>
        </div>
        {care.memberId === me.id && snap.members.length > 1 && !hasOpenRelay && (
          <button
            type="button"
            onClick={() => setConfirmRelay(true)}
            className="flex flex-col items-center gap-0.5 rounded-2xl px-2 py-1 text-xs font-bold text-peach-600 active:bg-peach-50 dark:active:bg-night-800"
          >
            <HandHeart className="size-5" aria-hidden />
            Passer le relais
          </button>
        )}
      </div>
      <Sheet open={confirmRelay} onClose={() => setConfirmRelay(false)} title="Passer le relais ?">
        <p className="mb-4 text-sm text-bark-600 dark:text-bark-400">
          Une demande de remplacement pour cette garde sera envoyée
          {relayTarget ? ` — ${memberById(snap, relayTarget)?.name} sera prévenu·e en premier` : ''}
          , puis aux suivants s’il faut.
        </p>
        <Button
          fullWidth
          variant="peach"
          onClick={() =>
            void tryAction(async () => {
              await provider.createSwapRequest({ carePeriodId: care.id })
              setConfirmRelay(false)
              toast('Demande envoyée', '🙏')
            })
          }
        >
          Envoyer la demande
        </Button>
      </Sheet>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Bannières de remplacement (cascade)
// ---------------------------------------------------------------------------

function SwapBanners({ snap, me }: { snap: AppSnapshot; me: Member }) {
  const toast = useToasts((s) => s.push)
  const incoming = swapsTargeting(snap.swapRequests, me.id)
  const sos = exhaustedSwaps(snap.swapRequests).filter((s) => s.requesterId !== me.id)
  const mine = snap.swapRequests.filter(
    (s) => s.requesterId === me.id && (s.status === 'open' || s.status === 'exhausted'),
  )

  const respond = (swap: SwapRequest, accept: boolean) =>
    void tryAction(async () => {
      await provider.respondSwap(swap.id, accept)
      toast(accept ? 'Merci, c’est noté !' : 'Refus transmis', accept ? '🙌' : '👌')
    })

  if (incoming.length + sos.length + mine.length === 0) return null

  return (
    <div className="mt-2 flex flex-col gap-3">
      {incoming.map((swap) => (
        <Card key={swap.id} className="bg-peach-50 ring-1 ring-peach-200 dark:bg-peach-900/20 dark:ring-peach-900">
          <div className="flex items-start gap-3">
            <Avatar member={memberById(snap, swap.requesterId)} size="md" />
            <div className="flex-1">
              <p className="font-bold">
                {memberById(snap, swap.requesterId)?.name} cherche un remplaçant pour{' '}
                {describeSwap(snap, swap)}
              </p>
              {swap.message && (
                <p className="mt-1 text-sm text-bark-600 italic dark:text-bark-400">
                  « {swap.message} »
                </p>
              )}
            </div>
          </div>
          <div className="mt-3 flex gap-2">
            <Button variant="primary" className="flex-1" onClick={() => respond(swap, true)}>
              J’accepte 🙌
            </Button>
            <Button variant="soft" className="flex-1" onClick={() => respond(swap, false)}>
              Je ne peux pas
            </Button>
          </div>
        </Card>
      ))}
      {sos.map((swap) => (
        <Card key={swap.id} className="ring-1 ring-peach-200 dark:ring-peach-900">
          <p className="font-bold">
            🆘 Personne n’est dispo pour {describeSwap(snap, swap)} — tu peux aider ?
          </p>
          <Button variant="peach" fullWidth className="mt-3" onClick={() => respond(swap, true)}>
            Je m’en occupe
          </Button>
        </Card>
      ))}
      {mine.map((swap) => {
        const target = swap.cascade[swap.cascade.length - 1]
        const waiting =
          swap.status === 'open' && target && !target.response
            ? memberById(snap, target.memberId)?.name
            : null
        return (
          <Card key={swap.id}>
            <div className="flex items-center gap-3">
              <Clock className="size-5 shrink-0 text-bark-400" aria-hidden />
              <p className="flex-1 text-sm font-semibold text-bark-600 dark:text-bark-400">
                Remplacement pour {describeSwap(snap, swap)} :{' '}
                {waiting ? `en attente de ${waiting}…` : 'en attente d’un volontaire…'}
              </p>
              <Button
                variant="ghost"
                size="sm"
                onClick={() =>
                  void tryAction(async () => {
                    await provider.cancelSwap(swap.id)
                  })
                }
              >
                Annuler
              </Button>
            </div>
            {/* Où en est la cascade : qui a été sollicité, qui a refusé. */}
            {swap.cascade.length > 0 && (
              <div className="mt-2 flex flex-col gap-1.5 border-t border-bark-100 pt-2 dark:border-night-800">
                {swap.cascade.map((step) => {
                  const stepMember = memberById(snap, step.memberId)
                  return (
                    <p
                      key={step.memberId}
                      className="flex items-center gap-2 text-xs font-semibold text-bark-500 dark:text-bark-400"
                    >
                      <Avatar member={stepMember} size="xs" />
                      {stepMember?.name ?? 'Un membre'}{' '}
                      {step.response === 'declined'
                        ? 'n’est pas disponible'
                        : `— sollicité·e à ${formatInstant(step.notifiedAt)}`}
                    </p>
                  )
                })}
              </div>
            )}
          </Card>
        )
      })}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Carte de créneau
// ---------------------------------------------------------------------------

function SlotCard({
  view,
  date,
  snap,
  me,
  onValidated,
}: {
  view: DaySlotView
  date: DateStr
  snap: AppSnapshot
  me: Member
  onValidated: () => void
}) {
  const navigate = useNavigate()
  const toast = useToasts((s) => s.push)
  const [menuOpen, setMenuOpen] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [postSheet, setPostSheet] = useState(false)
  const [cantSheet, setCantSheet] = useState(false)
  const photoUrl = usePhotoUrl(view.slot?.photo)

  const { template, slot, status } = view
  const assigned = memberById(snap, slot?.assignedMemberId)
  const validator = memberById(snap, slot?.validatedBy)
  const hours = `${formatTime(template.startTime)} – ${formatTime(template.endTime)}`
  const isMine = slot?.assignedMemberId === me.id
  const hasOpenSwap = snap.swapRequests.some(
    (s) =>
      (s.status === 'open' || s.status === 'exhausted') &&
      s.walkSlotDate === date &&
      s.walkSlotTemplateId === template.id,
  )

  const validate = () =>
    void tryAction(async () => {
      await provider.validateWalk({ date, slotTemplateId: template.id })
      onValidated()
      toast(`${snap.pet.name} a été promené !`, '🐾')
      setPostSheet(true)
    })

  // « Ajouter cet événement à mon agenda » : .ics d'un seul événement.
  const addToAgenda = () => {
    const ics = buildSingleEventIcs(
      `walk-${date}-${template.id}`,
      atTime(date, template.startTime),
      atTime(date, template.endTime),
      `🐾 Promenade ${template.name} – ${snap.pet.name}`,
    )
    const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `promenade-${date}.ics`
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
    setMenuOpen(false)
    toast('Événement téléchargé', '📅')
  }

  return (
    <Card
      className={cx(
        status === 'current' && 'ring-2 ring-sage-400',
        status === 'missed' && 'ring-2 ring-peach-400',
        status === 'skipped' && 'opacity-70',
      )}
    >
      <div className="flex items-center gap-3">
        <span className="text-3xl" aria-hidden>
          {template.emoji}
        </span>
        <div className="flex-1">
          <p className="font-extrabold">{template.name}</p>
          <p className="text-xs font-semibold text-bark-500 dark:text-bark-400">{hours}</p>
        </div>
        {status === 'done' || status === 'skipped' ? (
          <span className="flex items-center gap-1.5 px-2 py-1">
            {assigned && <MemberTag member={assigned} />}
          </span>
        ) : (
          <button
            type="button"
            onClick={() => setPickerOpen(true)}
            className="flex items-center gap-1.5 rounded-2xl px-2 py-1 active:bg-bark-50 dark:active:bg-night-800"
            aria-label="Changer le promeneur"
          >
            {assigned ? (
              <MemberTag member={assigned} />
            ) : (
              <span className="inline-flex items-center gap-1 text-sm font-semibold text-bark-400">
                <UserRound className="size-4" aria-hidden /> Personne
              </span>
            )}
          </button>
        )}
        <button
          type="button"
          aria-label="Plus d'options"
          onClick={() => setMenuOpen(true)}
          className="flex size-9 items-center justify-center rounded-full text-bark-400 active:bg-bark-100 dark:active:bg-night-800"
        >
          <MoreHorizontal className="size-5" />
        </button>
      </div>

      {status === 'done' && (
        <div className="mt-3 rounded-2xl bg-sage-50 p-3 dark:bg-sage-900/30">
          <p className="flex items-center gap-2 text-sm font-bold text-sage-800 dark:text-sage-200">
            <Check className="size-4" aria-hidden />
            Validée par {validator?.name ?? 'quelqu’un'}
            {slot?.validatedAt && <> · {formatInstant(slot.validatedAt)}</>}
          </p>
          {slot?.note && (
            <p className="mt-1 text-sm text-bark-700 italic dark:text-bark-300">« {slot.note} »</p>
          )}
          {photoUrl && (
            <img
              src={photoUrl}
              alt="Photo de la promenade"
              className="mt-2 max-h-44 w-full rounded-xl object-cover"
            />
          )}
        </div>
      )}

      {status === 'skipped' && (
        <p className="mt-3 flex items-center gap-2 text-sm font-semibold text-bark-500">
          Pas de promenade sur ce créneau
          <button
            type="button"
            onClick={() => void tryAction(() => provider.unvalidateWalk(date, template.id))}
            className="inline-flex items-center gap-1 font-bold text-sage-700 active:opacity-70 dark:text-sage-300"
          >
            <Undo2 className="size-4" aria-hidden /> Annuler
          </button>
        </p>
      )}

      {(status === 'current' || status === 'upcoming' || status === 'missed') && (
        <>
          {status === 'missed' && (
            <p className="mt-3 text-sm font-bold text-peach-600 dark:text-peach-300">
              ⚠️ Pas encore validée — le créneau se terminait à {formatTime(template.endTime)}
            </p>
          )}
          <div className="mt-3 flex gap-2">
            <Button
              variant={status === 'missed' ? 'peach' : status === 'current' ? 'primary' : 'soft'}
              className="flex-1"
              onClick={validate}
            >
              {status === 'upcoming' ? 'Valider en avance' : 'C’est promené !'} ✅
            </Button>
            {isMine && !hasOpenSwap && (
              <Button variant="ghost" onClick={() => setCantSheet(true)}>
                Je ne peux pas
              </Button>
            )}
          </div>
        </>
      )}

      {/* Choix du promeneur */}
      <MemberPicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        title={`Qui promène ${snap.pet.name} (${template.name.toLowerCase()}) ?`}
        members={snap.members}
        selectedId={slot?.assignedMemberId}
        allowNone
        onPick={(memberId) =>
          void tryAction(async () => {
            await provider.assignWalk(date, template.id, memberId)
            setPickerOpen(false)
          })
        }
      />

      {/* Menu ⋯ */}
      <Sheet open={menuOpen} onClose={() => setMenuOpen(false)} title={`${template.name} · ${hours}`}>
        <div className="flex flex-col gap-2">
          {status === 'done' && (
            <>
              <Button variant="soft" fullWidth onClick={() => { setMenuOpen(false); setPostSheet(true) }}>
                Ajouter une note ou une photo
              </Button>
              <Button
                variant="soft"
                fullWidth
                onClick={() =>
                  void tryAction(async () => {
                    await provider.unvalidateWalk(date, template.id)
                    setMenuOpen(false)
                  })
                }
              >
                <Undo2 className="size-5" aria-hidden /> Annuler la validation
              </Button>
            </>
          )}
          {(status === 'current' || status === 'upcoming' || status === 'missed') && (
            <Button
              variant="soft"
              fullWidth
              onClick={() =>
                void tryAction(async () => {
                  await provider.skipWalk(date, template.id)
                  setMenuOpen(false)
                })
              }
            >
              Pas de promenade sur ce créneau
            </Button>
          )}
          <Button
            variant="soft"
            fullWidth
            onClick={() => navigate(`/discussion?date=${date}&slot=${template.id}`)}
          >
            <MessageCircle className="size-5" aria-hidden /> Commenter dans la discussion
          </Button>
          <Button variant="soft" fullWidth onClick={addToAgenda}>
            <CalendarPlus className="size-5" aria-hidden /> Ajouter à mon agenda (.ics)
          </Button>
        </div>
      </Sheet>

      {/* Note + photo après validation */}
      <PostValidateSheet
        open={postSheet}
        onClose={() => setPostSheet(false)}
        date={date}
        slotTemplateId={template.id}
        initialNote={slot?.note}
      />

      {/* « Je ne peux pas » */}
      <CantSheet
        open={cantSheet}
        onClose={() => setCantSheet(false)}
        snap={snap}
        me={me}
        date={date}
        slotTemplateId={template.id}
      />
    </Card>
  )
}

function PostValidateSheet({
  open,
  onClose,
  date,
  slotTemplateId,
  initialNote,
}: {
  open: boolean
  onClose: () => void
  date: DateStr
  slotTemplateId: string
  initialNote?: string
}) {
  const [note, setNote] = useState(initialNote ?? '')
  const [photo, setPhoto] = useState<PhotoRef | undefined>()

  const save = () =>
    void tryAction(async () => {
      if (note.trim() || photo) {
        await provider.attachToWalk(date, slotTemplateId, {
          ...(note.trim() ? { note: note.trim() } : {}),
          ...(photo ? { photo } : {}),
        })
      }
      onClose()
    })

  return (
    <Sheet open={open} onClose={onClose} title="Un mot sur la promenade ? 🐾">
      <div className="flex flex-col gap-4">
        <TextArea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Il a couru partout, croisé deux copains…"
        />
        <PhotoInput value={photo} onChange={setPhoto} label="Ajouter une photo" />
        <div className="flex gap-2">
          <Button variant="ghost" className="flex-1" onClick={onClose}>
            Non merci
          </Button>
          <Button className="flex-1" onClick={save}>
            Enregistrer
          </Button>
        </div>
      </div>
    </Sheet>
  )
}

function CantSheet({
  open,
  onClose,
  snap,
  me,
  date,
  slotTemplateId,
}: {
  open: boolean
  onClose: () => void
  snap: AppSnapshot
  me: Member
  date: DateStr
  slotTemplateId: string
}) {
  const toast = useToasts((s) => s.push)
  const [message, setMessage] = useState('')
  const firstTarget = memberById(snap, nextCascadeTarget(snap.members, me.id, []) ?? undefined)

  return (
    <Sheet open={open} onClose={onClose} title="Besoin d’un remplaçant ?">
      <div className="flex flex-col gap-4">
        <p className="text-sm text-bark-600 dark:text-bark-400">
          {firstTarget
            ? `${firstTarget.name} sera prévenu·e en premier. Sans réponse ou en cas de refus, la demande passera au suivant de la liste.`
            : 'Ta demande sera visible par toute la famille.'}
        </p>
        <TextArea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="Un empêchement ? Explique en un mot (optionnel)…"
          rows={2}
        />
        <Button
          variant="peach"
          fullWidth
          onClick={() =>
            void tryAction(async () => {
              await provider.createSwapRequest({
                walkSlotDate: date,
                walkSlotTemplateId: slotTemplateId,
                message: message.trim() || undefined,
              })
              onClose()
              toast('Demande envoyée', '🙏')
            })
          }
        >
          Envoyer la demande
        </Button>
      </div>
    </Sheet>
  )
}
