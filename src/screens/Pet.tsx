/**
 * Onglet « Wint » : profil du chien, galerie, famille, créneaux,
 * notifications personnelles, calendrier et outils de démo.
 */
import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  BellRing,
  CalendarDays,
  Camera,
  Copy,
  GripVertical,
  LogOut,
  Pencil,
  Plus,
  RefreshCw,
  Share2,
  UserMinus,
  Users,
} from 'lucide-react'
import MemberPicker from '../components/MemberPicker'
import {
  Avatar,
  Button,
  Card,
  EmptyState,
  Field,
  SectionTitle,
  Sheet,
  TextArea,
  TextInput,
  Toggle,
  cx,
  inputClass,
} from '../components/ui'
import { provider } from '../data'
import { activeTemplates, galleryItems, membersByPriority, type GalleryItem } from '../domain/logic'
import { DEFAULT_PREFS, type AppSnapshot, type Member, type SlotTemplate } from '../domain/types'
import { ageLabel, formatInstant, formatTime } from '../lib/dates'
import { buildMemberIcs } from '../lib/ics'
import { newId } from '../lib/ids'
import { compressImage, usePhotoUrl } from '../lib/photos'
import { subscribeToPush } from '../pwa/push'
import { memberById, useActiveMember, useApp } from '../store/useApp'
import { tryAction, useToasts } from '../store/useToasts'

export default function PetScreen() {
  const { snap } = useApp()
  const me = useActiveMember()
  if (!snap || !me) return null
  const isOwner = me.role === 'owner'

  return (
    <div className="animate-fade">
      <PetHeader snap={snap} isOwner={isOwner} />
      <NotesCard snap={snap} isOwner={isOwner} />
      <GallerySection snap={snap} />
      <FamilySection snap={snap} me={me} isOwner={isOwner} />
      <InviteCard snap={snap} />
      <SlotsSection snap={snap} isOwner={isOwner} />
      <PrefsSection snap={snap} me={me} />
      <CalendarSection snap={snap} me={me} />
      <InstallCard />
      {provider.mode === 'demo' && <DemoTools snap={snap} me={me} />}
      <LeaveSection petName={snap.pet.name} />
    </div>
  )
}

// ---------------------------------------------------------------------------
// En-tête : photo, identité, édition de la fiche
// ---------------------------------------------------------------------------

function PetHeader({ snap, isOwner }: { snap: AppSnapshot; isOwner: boolean }) {
  const photoUrl = usePhotoUrl(snap.pet.photo)
  const inputRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const toast = useToasts((s) => s.push)

  const subtitle = [snap.pet.breed, snap.pet.birthDate ? ageLabel(snap.pet.birthDate) : null]
    .filter(Boolean)
    .join(' · ')

  const onFile = async (file: File | undefined) => {
    if (!file) return
    setBusy(true)
    await tryAction(async () => {
      const blob = await compressImage(file)
      const ref = await provider.savePhoto(blob)
      await provider.updatePet({ photo: ref })
      toast(`Nouvelle photo de ${snap.pet.name} !`, '📸')
    })
    setBusy(false)
    if (inputRef.current) inputRef.current.value = ''
  }

  return (
    <header className="flex items-center gap-4 pt-6 pb-2">
      <div className="relative shrink-0">
        {photoUrl ? (
          <img
            src={photoUrl}
            alt={snap.pet.name}
            className="size-24 rounded-full object-cover ring-4 ring-sage-200 dark:ring-sage-900"
          />
        ) : (
          <span className="flex size-24 items-center justify-center rounded-full bg-sage-100 text-5xl ring-4 ring-sage-200 dark:bg-sage-900/60 dark:ring-sage-900">
            🐕
          </span>
        )}
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => void onFile(e.target.files?.[0])}
        />
        <button
          type="button"
          aria-label="Changer la photo"
          disabled={busy}
          onClick={() => inputRef.current?.click()}
          className="absolute -right-1 -bottom-1 flex size-9 items-center justify-center rounded-full bg-sage-600 text-white shadow ring-2 ring-cream active:bg-sage-700 disabled:opacity-60 dark:ring-night-900"
        >
          <Camera className="size-4" aria-hidden />
        </button>
      </div>
      <div className="min-w-0 flex-1">
        <h1 className="text-3xl font-black tracking-tight">{snap.pet.name}</h1>
        {subtitle && (
          <p className="text-sm font-semibold text-bark-500 dark:text-bark-400">{subtitle}</p>
        )}
        {isOwner && (
          <Button variant="ghost" size="sm" className="-ml-3" onClick={() => setEditOpen(true)}>
            <Pencil className="size-4" aria-hidden /> Modifier
          </Button>
        )}
      </div>
      {editOpen && <EditPetSheet snap={snap} onClose={() => setEditOpen(false)} />}
    </header>
  )
}

function EditPetSheet({ snap, onClose }: { snap: AppSnapshot; onClose: () => void }) {
  const toast = useToasts((s) => s.push)
  const [name, setName] = useState(snap.pet.name)
  const [breed, setBreed] = useState(snap.pet.breed ?? '')
  const [birthDate, setBirthDate] = useState(snap.pet.birthDate ?? '')
  const [notes, setNotes] = useState(snap.pet.notes ?? '')

  const save = () =>
    void tryAction(async () => {
      await provider.updatePet({
        name: name.trim() || snap.pet.name,
        breed: breed.trim() || undefined,
        birthDate: birthDate || undefined,
        notes: notes.trim() || undefined,
      })
      toast('Fiche mise à jour', '🐕')
      onClose()
    })

  return (
    <Sheet open onClose={onClose} title={`La fiche de ${snap.pet.name}`}>
      <div className="flex flex-col gap-4">
        <Field label="Nom">
          <TextInput value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Race">
          <TextInput
            value={breed}
            onChange={(e) => setBreed(e.target.value)}
            placeholder="Berger australien, croisé…"
          />
        </Field>
        <Field label="Date de naissance">
          <TextInput type="date" value={birthDate} onChange={(e) => setBirthDate(e.target.value)} />
        </Field>
        <Field label="Carnet pratique" hint="Véto, allergies, petites manies… visible par toute la famille.">
          <TextArea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={4}
            placeholder="Véto : Dr Martin 01 23 45 67 89…"
          />
        </Field>
        <Button fullWidth onClick={save}>
          Enregistrer
        </Button>
      </div>
    </Sheet>
  )
}

// ---------------------------------------------------------------------------
// Carnet pratique
// ---------------------------------------------------------------------------

function NotesCard({ snap, isOwner }: { snap: AppSnapshot; isOwner: boolean }) {
  return (
    <Card className="mt-2">
      <p className="font-extrabold">📝 Carnet pratique</p>
      {snap.pet.notes ? (
        <p className="mt-1 text-sm whitespace-pre-wrap text-bark-700 dark:text-bark-300">
          {snap.pet.notes}
        </p>
      ) : (
        <p className="mt-1 text-sm text-bark-500 dark:text-bark-400">
          Véto, habitudes, petites manies…{' '}
          {isOwner
            ? 'Ajoute tout ce qui est utile via « Modifier ».'
            : `Le propriétaire peut noter ici tout ce qui est utile pour ${snap.pet.name}.`}
        </p>
      )}
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Galerie
// ---------------------------------------------------------------------------

function GalleryThumb({ item, onOpen }: { item: GalleryItem; onOpen: () => void }) {
  const url = usePhotoUrl(item.photo)
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label="Voir la photo en grand"
      className="aspect-square overflow-hidden rounded-xl bg-bark-100 active:opacity-80 dark:bg-night-800"
    >
      {url && <img src={url} alt="" className="size-full object-cover" loading="lazy" />}
    </button>
  )
}

function GalleryPhotoSheet({
  snap,
  item,
  onClose,
}: {
  snap: AppSnapshot
  item: GalleryItem
  onClose: () => void
}) {
  const url = usePhotoUrl(item.photo)
  const author = memberById(snap, item.authorId)
  return (
    <Sheet open onClose={onClose} title={`Photo de ${snap.pet.name}`}>
      {url && (
        <img
          src={url}
          alt={item.caption ?? `Photo de ${snap.pet.name}`}
          className="max-h-[60dvh] w-full rounded-2xl object-contain"
        />
      )}
      {item.caption && (
        <p className="mt-3 text-sm text-bark-700 italic dark:text-bark-300">« {item.caption} »</p>
      )}
      <p className="mt-2 text-sm font-semibold text-bark-500 dark:text-bark-400">
        {item.source === 'walk' ? '🐾' : '💬'} par {author?.name ?? 'un membre'} ·{' '}
        {formatInstant(item.createdAt)}
      </p>
    </Sheet>
  )
}

function GallerySection({ snap }: { snap: AppSnapshot }) {
  const items = galleryItems(snap.walkSlots, snap.messages)
  const [selected, setSelected] = useState<GalleryItem | null>(null)

  return (
    <>
      <SectionTitle>Galerie de {snap.pet.name}</SectionTitle>
      {items.length === 0 ? (
        <EmptyState
          emoji="📸"
          title="Pas encore de photos"
          text="Les photos des promenades et de la discussion apparaîtront ici."
        />
      ) : (
        <div className="grid grid-cols-3 gap-1.5">
          {items.map((item) => (
            <GalleryThumb key={item.photo} item={item} onOpen={() => setSelected(item)} />
          ))}
        </div>
      )}
      {selected && (
        <GalleryPhotoSheet snap={snap} item={selected} onClose={() => setSelected(null)} />
      )}
    </>
  )
}

// ---------------------------------------------------------------------------
// Famille : membres, priorité de cascade, invitation
// ---------------------------------------------------------------------------

function FamilySection({
  snap,
  me,
  isOwner,
}: {
  snap: AppSnapshot
  me: Member
  isOwner: boolean
}) {
  const toast = useToasts((s) => s.push)
  const [removeTarget, setRemoveTarget] = useState<Member | null>(null)
  const ordered = membersByPriority(snap.members)
  const listRef = useRef<HTMLDivElement>(null)
  /** Glisser-déposer en cours : ligne saisie, position cible, décalage doigt. */
  const [drag, setDrag] = useState<{ from: number; to: number; dy: number; h: number } | null>(null)

  const commitOrder = (ids: string[]) =>
    void tryAction(async () => {
      await provider.updateMemberPriorities(ids)
      toast('Ordre mis à jour', '👍')
    })

  const move = (index: number, delta: number) => {
    const target = index + delta
    if (target < 0 || target >= ordered.length) return
    const ids = ordered.map((m) => m.id)
    ;[ids[index], ids[target]] = [ids[target], ids[index]]
    commitOrder(ids)
  }

  const startDrag = (e: React.PointerEvent<HTMLButtonElement>, index: number) => {
    e.preventDefault()
    const row = listRef.current?.children[index] as HTMLElement | undefined
    const h = (row?.getBoundingClientRect().height ?? 56) + 4 // + gap
    const startY = e.clientY
    const targetFor = (dy: number) =>
      Math.min(ordered.length - 1, Math.max(0, index + Math.round(dy / h)))
    setDrag({ from: index, to: index, dy: 0, h })
    const onMove = (ev: PointerEvent) => {
      const dy = ev.clientY - startY
      setDrag({ from: index, to: targetFor(dy), dy, h })
    }
    const onUp = (ev: PointerEvent) => {
      document.removeEventListener('pointermove', onMove)
      document.removeEventListener('pointerup', onUp)
      document.removeEventListener('pointercancel', onUp)
      setDrag(null)
      const to = targetFor(ev.clientY - startY)
      if (to !== index) {
        const ids = ordered.map((m) => m.id)
        const [moved] = ids.splice(index, 1)
        ids.splice(to, 0, moved)
        commitOrder(ids)
      }
    }
    document.addEventListener('pointermove', onMove)
    document.addEventListener('pointerup', onUp)
    document.addEventListener('pointercancel', onUp)
  }

  /** Décalage visuel des autres lignes pendant le glisser. */
  const rowShift = (i: number): number => {
    if (!drag || i === drag.from) return 0
    if (drag.from < drag.to && i > drag.from && i <= drag.to) return -drag.h
    if (drag.to < drag.from && i >= drag.to && i < drag.from) return drag.h
    return 0
  }

  return (
    <>
      <SectionTitle>La famille</SectionTitle>
      <Card className="p-2">
        <div ref={listRef} className="flex flex-col gap-1">
          {ordered.map((m, i) => (
            <div
              key={m.id}
              className={cx(
                'flex items-center gap-2 rounded-2xl p-2',
                drag?.from === i &&
                  'relative z-10 scale-[1.02] bg-white shadow-lg ring-1 ring-sage-300 dark:bg-night-800 dark:ring-sage-800',
              )}
              style={{
                transform: `translateY(${drag?.from === i ? drag.dy : rowShift(i)}px)`,
                transition: drag && drag.from !== i ? 'transform 0.15s ease' : undefined,
              }}
            >
              {isOwner && (
                <button
                  type="button"
                  aria-label={`Réordonner ${m.name} (glisser, ou flèches haut/bas)`}
                  onPointerDown={(e) => startDrag(e, i)}
                  onKeyDown={(e) => {
                    if (e.key === 'ArrowUp') {
                      e.preventDefault()
                      move(i, -1)
                    }
                    if (e.key === 'ArrowDown') {
                      e.preventDefault()
                      move(i, 1)
                    }
                  }}
                  className="flex size-9 shrink-0 cursor-grab touch-none items-center justify-center rounded-full text-bark-400 active:cursor-grabbing active:bg-bark-100 dark:active:bg-night-800"
                >
                  <GripVertical className="size-5" />
                </button>
              )}
              <span className="w-4 shrink-0 text-center text-xs font-black text-bark-400" aria-hidden>
                {i + 1}
              </span>
              <Avatar member={m} size="md" />
              <span className="min-w-0 flex-1 truncate font-bold">
                {m.name}
                {m.id === me.id && <span className="font-semibold text-bark-400"> (toi)</span>}
              </span>
              {m.role === 'owner' && (
                <span className="rounded-full bg-sage-100 px-2.5 py-1 text-xs font-bold text-sage-800 dark:bg-sage-900/60 dark:text-sage-200">
                  Propriétaire
                </span>
              )}
              {isOwner && m.role !== 'owner' && (
                <button
                  type="button"
                  aria-label={`Retirer ${m.name} du foyer`}
                  onClick={() => setRemoveTarget(m)}
                  className="flex size-9 shrink-0 items-center justify-center rounded-full text-red-500 active:bg-red-50 dark:active:bg-red-950/40"
                >
                  <UserMinus className="size-4" />
                </button>
              )}
            </div>
          ))}
        </div>
      </Card>
      {isOwner && (
        <p className="mt-2 px-2 text-xs text-bark-500 dark:text-bark-400">
          L’ordre définit qui est prévenu·e en premier lors d’une demande de remplacement — fais
          glisser une ligne par sa poignée pour réordonner.
        </p>
      )}
      {isOwner && (
        <Card className="mt-3">
          <p className="text-sm font-extrabold">⏱️ Délai avant de solliciter le suivant</p>
          <p className="mt-1 text-xs text-bark-500 dark:text-bark-400">
            Sans réponse à une demande de remplacement après ce délai, la personne suivante de la
            liste est prévenue automatiquement.
          </p>
          <div className="mt-2 flex gap-1 rounded-2xl bg-bark-100 p-1 dark:bg-night-800">
            {[15, 30, 60].map((min) => (
              <button
                key={min}
                type="button"
                onClick={() =>
                  void tryAction(async () => {
                    await provider.updateHousehold({ swapEscalateMinutes: min })
                  })
                }
                className={cx(
                  'flex-1 rounded-xl py-2 text-xs font-bold transition-colors',
                  (snap.household.swapEscalateMinutes ?? 30) === min
                    ? 'bg-white text-bark-900 shadow-sm dark:bg-night-850 dark:text-cream'
                    : 'text-bark-500 dark:text-bark-400',
                )}
              >
                {min} min
              </button>
            ))}
          </div>
        </Card>
      )}
      {removeTarget && (
        <Sheet open onClose={() => setRemoveTarget(null)} title={`Retirer ${removeTarget.name} ?`}>
          <p className="mb-4 text-sm text-bark-600 dark:text-bark-400">
            {removeTarget.name} ne verra plus le planning ni la discussion, et ses promenades à
            venir seront libérées. Il ou elle pourra revenir avec le code d’invitation.
          </p>
          <Button
            variant="danger"
            fullWidth
            onClick={() =>
              void tryAction(async () => {
                await provider.removeMember(removeTarget.id)
                toast(`${removeTarget.name} a été retiré·e du foyer`, '👋')
                setRemoveTarget(null)
              })
            }
          >
            <UserMinus className="size-5" aria-hidden /> Retirer {removeTarget.name}
          </Button>
        </Sheet>
      )}
    </>
  )
}

function InviteCard({ snap }: { snap: AppSnapshot }) {
  const toast = useToasts((s) => s.push)
  const code = snap.household.inviteCode
  const inviteUrl = `${location.origin}/bienvenue?code=${code}`

  const copyCode = () =>
    void tryAction(async () => {
      await navigator.clipboard.writeText(code)
      toast('Code copié !', '📋')
    })

  const shareLink = () =>
    void tryAction(async () => {
      if (typeof navigator.share === 'function') {
        try {
          await navigator.share({ url: inviteUrl })
        } catch (e) {
          if (e instanceof DOMException && e.name === 'AbortError') return
          throw e
        }
      } else {
        await navigator.clipboard.writeText(inviteUrl)
        toast('Lien d’invitation copié !', '🔗')
      }
    })

  return (
    <Card className="mt-3">
      <p className="flex items-center gap-2 text-sm font-bold text-bark-600 dark:text-bark-400">
        <Users className="size-4" aria-hidden /> Invite la famille avec ce code
      </p>
      <p className="my-3 text-center text-4xl font-black tracking-widest">{code}</p>
      <div className="flex gap-2">
        <Button variant="soft" className="flex-1" onClick={copyCode}>
          <Copy className="size-5" aria-hidden /> Copier le code
        </Button>
        <Button variant="soft" className="flex-1" onClick={shareLink}>
          <Share2 className="size-5" aria-hidden /> Partager le lien
        </Button>
      </div>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Créneaux de promenade
// ---------------------------------------------------------------------------

const SLOT_EMOJIS = ['🌅', '☀️', '🌇', '🌙', '⭐', '🐾'] as const

function SlotsSection({ snap, isOwner }: { snap: AppSnapshot; isOwner: boolean }) {
  const [sheet, setSheet] = useState<{ existing?: SlotTemplate } | null>(null)
  const templates = isOwner
    ? snap.slotTemplates
        .slice()
        .sort((a, b) => a.sortOrder - b.sortOrder || a.startTime.localeCompare(b.startTime))
    : activeTemplates(snap.slotTemplates)

  return (
    <>
      <SectionTitle>Créneaux de promenade</SectionTitle>
      {templates.length === 0 ? (
        <EmptyState
          emoji="🦴"
          title="Aucun créneau défini"
          text={
            isOwner
              ? 'Ajoute les moments de promenade de la journée.'
              : 'Le propriétaire n’a pas encore défini les créneaux.'
          }
        />
      ) : (
        <Card className="flex flex-col divide-y divide-bark-100 p-2 dark:divide-night-800">
          {templates.map((t) => (
            <div key={t.id} className={cx('flex items-center gap-3 p-2', !t.active && 'opacity-50')}>
              <button
                type="button"
                disabled={!isOwner}
                onClick={() => setSheet({ existing: t })}
                className="flex min-w-0 flex-1 items-center gap-3 rounded-2xl text-left active:bg-bark-50 disabled:active:bg-transparent dark:active:bg-night-800"
              >
                <span className="text-2xl" aria-hidden>
                  {t.emoji}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-bold">{t.name}</span>
                  <span className="block text-xs font-semibold text-bark-500 dark:text-bark-400">
                    {formatTime(t.startTime)} – {formatTime(t.endTime)}
                  </span>
                </span>
              </button>
              {isOwner && (
                <Toggle
                  checked={t.active}
                  label={`Activer le créneau ${t.name}`}
                  onChange={(active) =>
                    void tryAction(() =>
                      provider.upsertSlotTemplate({
                        id: t.id,
                        name: t.name,
                        emoji: t.emoji,
                        startTime: t.startTime,
                        endTime: t.endTime,
                        sortOrder: t.sortOrder,
                        active,
                      }),
                    )
                  }
                />
              )}
            </div>
          ))}
        </Card>
      )}
      {isOwner && (
        <Button variant="soft" fullWidth className="mt-2" onClick={() => setSheet({})}>
          <Plus className="size-5" aria-hidden /> Ajouter un créneau
        </Button>
      )}
      {sheet && <SlotSheet snap={snap} existing={sheet.existing} onClose={() => setSheet(null)} />}
    </>
  )
}

function SlotSheet({
  snap,
  existing,
  onClose,
}: {
  snap: AppSnapshot
  existing?: SlotTemplate
  onClose: () => void
}) {
  const toast = useToasts((s) => s.push)
  const [name, setName] = useState(existing?.name ?? '')
  const [emoji, setEmoji] = useState(existing?.emoji ?? '🐾')
  const [start, setStart] = useState(existing?.startTime ?? '08:00')
  const [end, setEnd] = useState(existing?.endTime ?? '09:00')

  const save = () =>
    void tryAction(async () => {
      await provider.upsertSlotTemplate({
        id: existing?.id ?? newId(),
        name: name.trim() || 'Promenade',
        emoji,
        startTime: start,
        endTime: end,
        sortOrder: existing?.sortOrder ?? snap.slotTemplates.length,
        active: existing?.active ?? true,
      })
      toast(existing ? 'Créneau mis à jour' : 'Créneau ajouté', '🐾')
      onClose()
    })

  const remove = () =>
    void tryAction(async () => {
      if (!existing) return
      await provider.deleteSlotTemplate(existing.id)
      toast('Créneau supprimé', '🗑️')
      onClose()
    })

  return (
    <Sheet open onClose={onClose} title={existing ? `Modifier « ${existing.name} »` : 'Nouveau créneau'}>
      <div className="flex flex-col gap-4">
        <Field label="Nom du créneau">
          <TextInput
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Matin, Midi, Soir…"
          />
        </Field>
        <div>
          <span className="mb-1.5 block px-1 text-sm font-bold text-bark-700 dark:text-bark-300">
            Émoji
          </span>
          <div className="flex gap-2">
            {SLOT_EMOJIS.map((e) => (
              <button
                key={e}
                type="button"
                aria-label={`Choisir l’émoji ${e}`}
                onClick={() => setEmoji(e)}
                className={cx(
                  'flex size-11 items-center justify-center rounded-2xl bg-white text-xl shadow-sm dark:bg-night-850',
                  emoji === e && 'ring-2 ring-sage-500',
                )}
              >
                {e}
              </button>
            ))}
          </div>
        </div>
        <div className="flex gap-3">
          <Field label="Début">
            <TextInput type="time" value={start} onChange={(e) => setStart(e.target.value)} />
          </Field>
          <Field label="Fin">
            <TextInput type="time" value={end} onChange={(e) => setEnd(e.target.value)} />
          </Field>
        </div>
        <Button fullWidth onClick={save}>
          Enregistrer
        </Button>
        {existing && (
          <div>
            <Button variant="danger" fullWidth onClick={remove}>
              Supprimer ce créneau
            </Button>
            <p className="mt-2 px-1 text-xs text-bark-500 dark:text-bark-400">
              Les promenades déjà validées restent dans l’historique.
            </p>
          </div>
        )}
      </div>
    </Sheet>
  )
}

// ---------------------------------------------------------------------------
// Mes notifications
// ---------------------------------------------------------------------------

const PREF_ROWS: {
  key: 'walkReminder' | 'missedWalk' | 'careReminder' | 'swaps' | 'chat'
  label: string
}[] = [
  { key: 'walkReminder', label: 'Rappel avant mes promenades' },
  { key: 'missedWalk', label: 'Promenade non validée' },
  { key: 'careReminder', label: 'Rappel de mes gardes' },
  { key: 'swaps', label: 'Demandes de remplacement' },
  { key: 'chat', label: 'Nouveaux messages' },
]

const LEAD_CHOICES = [15, 30, 45, 60]

function PrefsSection({ snap, me }: { snap: AppSnapshot; me: Member }) {
  const toast = useToasts((s) => s.push)
  const [pushBusy, setPushBusy] = useState(false)
  const prefs = snap.prefs.find((p) => p.memberId === me.id) ?? { memberId: me.id, ...DEFAULT_PREFS }
  const vapidKey = import.meta.env.VITE_VAPID_PUBLIC_KEY

  const enablePush = async () => {
    if (!vapidKey) return
    setPushBusy(true)
    const ok = await tryAction(() => subscribeToPush(vapidKey))
    if (ok) toast('Notifications activées sur cet appareil', '🔔')
    setPushBusy(false)
  }

  return (
    <>
      <SectionTitle>Mes notifications</SectionTitle>
      <Card className="flex flex-col divide-y divide-bark-100 dark:divide-night-800">
        {PREF_ROWS.map(({ key, label }) => (
          <div key={key} className="flex items-center justify-between gap-3 py-3 first:pt-1 last:pb-1">
            <span className="text-sm font-bold">{label}</span>
            <Toggle
              checked={prefs[key]}
              label={label}
              onChange={(v) => void tryAction(() => provider.updatePrefs({ [key]: v }))}
            />
          </div>
        ))}
      </Card>
      <Card className="mt-3">
        <p className="text-sm font-bold">Me prévenir avant le créneau</p>
        <div className="mt-2 flex gap-2">
          {LEAD_CHOICES.map((min) => (
            <button
              key={min}
              type="button"
              onClick={() => void tryAction(() => provider.updatePrefs({ leadMinutes: min }))}
              className={cx(
                'flex-1 rounded-2xl py-2 text-sm font-bold transition-colors',
                prefs.leadMinutes === min
                  ? 'bg-sage-600 text-white'
                  : 'bg-sage-100 text-sage-800 active:bg-sage-200 dark:bg-sage-900/60 dark:text-sage-200',
              )}
            >
              {min} min
            </button>
          ))}
        </div>
        <p className="mt-4 text-sm font-bold">Ne pas me déranger entre…</p>
        <div className="mt-2 flex items-center gap-2">
          <input
            type="time"
            aria-label="Début des heures de silence"
            value={prefs.quietStart ?? ''}
            onChange={(e) =>
              void tryAction(() => provider.updatePrefs({ quietStart: e.target.value || undefined }))
            }
            className={cx(inputClass, 'flex-1')}
          />
          <span className="text-sm font-semibold text-bark-500">et</span>
          <input
            type="time"
            aria-label="Fin des heures de silence"
            value={prefs.quietEnd ?? ''}
            onChange={(e) =>
              void tryAction(() => provider.updatePrefs({ quietEnd: e.target.value || undefined }))
            }
            className={cx(inputClass, 'flex-1')}
          />
        </div>
      </Card>
      {provider.mode === 'supabase' && vapidKey && (
        <Button
          variant="soft"
          fullWidth
          className="mt-3"
          loading={pushBusy}
          onClick={() => void enablePush()}
        >
          <BellRing className="size-5" aria-hidden /> Activer les notifications sur cet appareil
        </Button>
      )}
      {provider.mode === 'demo' && (
        <p className="mt-2 px-2 text-xs text-bark-500 dark:text-bark-400">
          En mode démo, les rappels s’affichent uniquement dans l’app.
        </p>
      )}
    </>
  )
}

// ---------------------------------------------------------------------------
// Calendrier (.ics)
// ---------------------------------------------------------------------------

function CalendarSection({ snap, me }: { snap: AppSnapshot; me: Member }) {
  const toast = useToasts((s) => s.push)
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
  const feedUrl =
    me.calendarToken && provider.mode === 'supabase' && supabaseUrl
      ? `${supabaseUrl}/functions/v1/ics?token=${me.calendarToken}`
      : null

  const download = () => {
    const ics = buildMemberIcs(snap, me.id)
    const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'dogagenda.ics'
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
    toast('Calendrier téléchargé', '📅')
  }

  return (
    <>
      <SectionTitle>Calendrier</SectionTitle>
      <Card>
        <p className="text-sm text-bark-600 dark:text-bark-400">
          Retrouve tes gardes et promenades dans ton agenda (Google Calendar, Apple…).
        </p>
        <Button variant="soft" fullWidth className="mt-3" onClick={download}>
          <CalendarDays className="size-5" aria-hidden /> Télécharger mon calendrier (.ics)
        </Button>
        {feedUrl && (
          <a
            href="https://calendar.google.com/calendar/u/0/r/settings/addbyurl"
            target="_blank"
            rel="noreferrer"
            className="mt-2 flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-sage-100 text-base font-bold text-sage-800 active:bg-sage-200 dark:bg-sage-900/60 dark:text-sage-200"
          >
            <CalendarDays className="size-5" aria-hidden /> Ajouter à Google Calendar
          </a>
        )}
        {feedUrl && (
          <div className="mt-3">
            <p className="text-xs text-bark-500 dark:text-bark-400">
              Copie cette adresse, puis colle-la dans Google Calendar (« Ajouter un agenda » →
              « À partir de l’URL », bouton ci-dessus) ou dans Apple Calendrier (« Nouvel abonnement
              à un calendrier »). Tes gardes et promenades se mettront à jour automatiquement.
            </p>
            <button
              type="button"
              onClick={() =>
                void tryAction(async () => {
                  await navigator.clipboard.writeText(feedUrl)
                  toast('Adresse copiée !', '🔗')
                })
              }
              className="mt-1.5 flex w-full items-center gap-2 rounded-2xl bg-bark-50 px-3 py-2.5 text-left dark:bg-night-800"
            >
              <span className="min-w-0 flex-1 truncate font-mono text-xs text-bark-600 dark:text-bark-300">
                {feedUrl}
              </span>
              <Copy className="size-4 shrink-0 text-bark-400" aria-hidden />
            </button>
          </div>
        )}
      </Card>
    </>
  )
}

// ---------------------------------------------------------------------------
// Outils de démo
// ---------------------------------------------------------------------------

function DemoTools({ snap, me }: { snap: AppSnapshot; me: Member }) {
  const adoptSession = useApp((s) => s.adoptSession)
  const toast = useToasts((s) => s.push)
  const [pickerOpen, setPickerOpen] = useState(false)

  return (
    <>
      <SectionTitle>Mode démo</SectionTitle>
      <Card className="flex flex-col gap-2">
        <Button variant="soft" fullWidth onClick={() => setPickerOpen(true)}>
          <Users className="size-5" aria-hidden /> Changer de membre (démo)
        </Button>
        <Button
          variant="soft"
          fullWidth
          onClick={() =>
            void tryAction(async () => {
              const session = await provider.loadDemoData()
              await adoptSession(session)
              toast('Démo réinitialisée', '✨')
            })
          }
        >
          <RefreshCw className="size-5" aria-hidden /> Réinitialiser la démo
        </Button>
      </Card>
      <MemberPicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        title="Qui utilise l’appareil ?"
        members={snap.members}
        selectedId={me.id}
        onPick={(memberId) => {
          if (!memberId) return
          void tryAction(async () => {
            const session = await provider.switchMember(memberId)
            await adoptSession(session)
            setPickerOpen(false)
            toast('Te voilà connecté·e !', '👋')
          })
        }}
      />
    </>
  )
}

// ---------------------------------------------------------------------------
// Installation sur l'écran d'accueil
// ---------------------------------------------------------------------------

function InstallCard() {
  const [sheetOpen, setSheetOpen] = useState(false)
  const standalone =
    typeof window !== 'undefined' &&
    (window.matchMedia('(display-mode: standalone)').matches ||
      (navigator as { standalone?: boolean }).standalone === true)
  if (standalone) return null

  return (
    <>
      <SectionTitle>Installation</SectionTitle>
      <Card>
        <p className="text-sm text-bark-600 dark:text-bark-400">
          Installe Dogagenda sur ton écran d’accueil : l’app s’ouvre en plein écran, comme une
          vraie application — sans passer par un store.
        </p>
        <Button variant="soft" fullWidth className="mt-3" onClick={() => setSheetOpen(true)}>
          📲 Comment installer ?
        </Button>
      </Card>
      <Sheet open={sheetOpen} onClose={() => setSheetOpen(false)} title="Ajouter à l’écran d’accueil 📲">
        <div className="flex flex-col gap-4 text-sm text-bark-700 dark:text-bark-300">
          <div>
            <p className="font-extrabold"> Sur iPhone / iPad (Safari)</p>
            <ol className="mt-1 list-decimal space-y-1 pl-5">
              <li>Touche le bouton Partager (le carré avec une flèche).</li>
              <li>Fais défiler et choisis « Sur l’écran d’accueil ».</li>
              <li>Confirme avec « Ajouter » — c’est tout !</li>
            </ol>
          </div>
          <div>
            <p className="font-extrabold">🤖 Sur Android (Chrome)</p>
            <ol className="mt-1 list-decimal space-y-1 pl-5">
              <li>Ouvre le menu ⋮ en haut à droite.</li>
              <li>Choisis « Installer l’application » (ou « Ajouter à l’écran d’accueil »).</li>
              <li>Confirme — l’icône 🐾 apparaît sur ton écran d’accueil.</li>
            </ol>
          </div>
        </div>
      </Sheet>
    </>
  )
}

// ---------------------------------------------------------------------------
// Quitter le foyer
// ---------------------------------------------------------------------------

function LeaveSection({ petName }: { petName: string }) {
  const navigate = useNavigate()
  const signOut = useApp((s) => s.signOut)
  const [confirmOpen, setConfirmOpen] = useState(false)

  return (
    <div className="mt-8 pb-4">
      <Button variant="danger" fullWidth onClick={() => setConfirmOpen(true)}>
        <LogOut className="size-5" aria-hidden /> Quitter le foyer
      </Button>
      <Sheet open={confirmOpen} onClose={() => setConfirmOpen(false)} title="Quitter le foyer ?">
        <p className="mb-4 text-sm text-bark-600 dark:text-bark-400">
          Tu ne verras plus le planning ni la discussion de {petName} sur cet appareil. Tu pourras
          revenir à tout moment avec le code d’invitation.
        </p>
        <Button
          variant="danger"
          fullWidth
          onClick={() =>
            void tryAction(async () => {
              await signOut()
              navigate('/bienvenue', { replace: true })
            })
          }
        >
          Oui, je quitte le foyer
        </Button>
      </Sheet>
    </div>
  )
}
