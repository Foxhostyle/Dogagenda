import { useState } from 'react'
import {
  CalendarCheck,
  CalendarPlus,
  ChevronLeft,
  ChevronRight,
  Check,
  Copy,
  Star,
  Trash2,
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
  TextInput,
  cx,
} from '../components/ui'
import { provider } from '../data'
import { activeTemplates, carePeriodsOfWeek, findWalkSlot } from '../domain/logic'
import type { AppSnapshot, CarePeriod, Member, SlotTemplate } from '../domain/types'
import {
  addDaysStr,
  atTime,
  formatDayShort,
  formatInstant,
  formatTime,
  isToday,
  mondayOf,
  parseIso,
  toDateStr,
  todayStr,
  weekDates,
  weekLabel,
  type DateStr,
} from '../lib/dates'
import { memberById, useActiveMember, useApp } from '../store/useApp'
import { tryAction, useToasts } from '../store/useToasts'

type Scope = 'one' | 'template' | 'week'

/** « matin » → « matins », « après-midi » → « après-midis » (déjà en -s : inchangé). */
function pluralizeSlot(name: string): string {
  const lower = name.toLowerCase()
  return lower.endsWith('s') ? lower : `${lower}s`
}

/** `HH:mm` local d'un instant ISO. */
function timeOf(iso: string): string {
  const d = parseIso(iso)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

export default function Planning() {
  const { snap, tick } = useApp()
  const me = useActiveMember()
  void tick // recalcul du badge « Aujourd’hui » chaque minute
  const [monday, setMonday] = useState<DateStr>(() => mondayOf(todayStr()))
  const [careEditor, setCareEditor] = useState<{ period: CarePeriod | null } | null>(null)

  if (!snap || !me) return null
  const templates = activeTemplates(snap.slotTemplates)
  const currentMonday = mondayOf(todayStr())

  return (
    <div className="animate-fade">
      <WeekHeader
        monday={monday}
        currentMonday={currentMonday}
        onChange={setMonday}
      />

      <SectionTitle
        action={
          <button
            type="button"
            onClick={() => setCareEditor({ period: null })}
            className="text-sm font-bold text-sage-700 active:opacity-70 dark:text-sage-300"
          >
            + Ajouter une garde
          </button>
        }
      >
        Garde
      </SectionTitle>
      <CareStrip snap={snap} monday={monday} onEdit={(period) => setCareEditor({ period })} />

      {templates.length === 0 ? (
        <div className="mt-6">
          <EmptyState
            emoji="🦴"
            title="Aucun créneau de promenade défini"
            text={`Configure les créneaux du foyer dans l’onglet ${snap.pet.name} pour planifier la semaine.`}
          />
        </div>
      ) : (
        <>
          <SectionTitle>Les promenades de la semaine</SectionTitle>
          <WeekActions snap={snap} monday={monday} />
          <WeekGrid snap={snap} monday={monday} templates={templates} />
        </>
      )}

      {careEditor && (
        <CareSheet
          snap={snap}
          me={me}
          monday={monday}
          period={careEditor.period}
          onClose={() => setCareEditor(null)}
        />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// En-tête de semaine
// ---------------------------------------------------------------------------

function WeekHeader({
  monday,
  currentMonday,
  onChange,
}: {
  monday: DateStr
  currentMonday: DateStr
  onChange: (monday: DateStr) => void
}) {
  const navClass =
    'flex size-11 shrink-0 items-center justify-center rounded-2xl bg-white text-bark-600 shadow-sm shadow-bark-200/40 active:bg-sage-50 dark:bg-night-850 dark:text-bark-300 dark:shadow-none dark:ring-1 dark:ring-night-800 dark:active:bg-night-800'
  return (
    <header className="flex items-center gap-2 pt-6 pb-2">
      <button
        type="button"
        aria-label="Semaine précédente"
        onClick={() => onChange(addDaysStr(monday, -7))}
        className={navClass}
      >
        <ChevronLeft className="size-5" />
      </button>
      <div className="flex flex-1 flex-col items-center">
        <h1 className="text-xl font-black tracking-tight">{weekLabel(monday)}</h1>
        {monday !== currentMonday && (
          <button
            type="button"
            onClick={() => onChange(currentMonday)}
            className="text-sm font-bold text-sage-700 active:opacity-70 dark:text-sage-300"
          >
            Revenir à aujourd’hui
          </button>
        )}
      </div>
      <button
        type="button"
        aria-label="Semaine suivante"
        onClick={() => onChange(addDaysStr(monday, 7))}
        className={navClass}
      >
        <ChevronRight className="size-5" />
      </button>
    </header>
  )
}

// ---------------------------------------------------------------------------
// Bandeau des gardes
// ---------------------------------------------------------------------------

function CareStrip({
  snap,
  monday,
  onEdit,
}: {
  snap: AppSnapshot
  monday: DateStr
  onEdit: (period: CarePeriod) => void
}) {
  const periods = carePeriodsOfWeek(snap.carePeriods, monday)

  if (periods.length === 0) {
    return (
      <Card className="flex items-center gap-3">
        <span className="text-2xl" aria-hidden>
          🏡
        </span>
        <p className="text-sm font-semibold text-bark-500 dark:text-bark-400">
          Personne ne garde {snap.pet.name} cette semaine — ajoute une garde pour que tout le monde
          sache chez qui il est.
        </p>
      </Card>
    )
  }

  return (
    <div className="flex flex-col gap-2">
      {periods.map((p) => {
        const keeper = memberById(snap, p.memberId)
        return (
          <Card key={p.id} className="flex items-center gap-3" onClick={() => onEdit(p)}>
            <Avatar member={keeper} size="md" />
            <div className="flex-1">
              <p className="font-extrabold">
                {keeper?.name ?? 'Quelqu’un'} garde {snap.pet.name}
              </p>
              <p className="text-sm font-semibold text-bark-500 dark:text-bark-400">
                du {formatInstant(p.startAt)} au {formatInstant(p.endAt)}
              </p>
            </div>
            <ChevronRight className="size-5 text-bark-400" aria-hidden />
          </Card>
        )
      })}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Feuille d'édition d'une garde
// ---------------------------------------------------------------------------

function CareSheet({
  snap,
  me,
  monday,
  period,
  onClose,
}: {
  snap: AppSnapshot
  me: Member
  monday: DateStr
  period: CarePeriod | null
  onClose: () => void
}) {
  const toast = useToasts((s) => s.push)
  const [memberId, setMemberId] = useState(period?.memberId ?? me.id)
  const [startDate, setStartDate] = useState<DateStr>(
    period ? toDateStr(parseIso(period.startAt)) : monday,
  )
  const [startTime, setStartTime] = useState(period ? timeOf(period.startAt) : '08:00')
  const [endDate, setEndDate] = useState<DateStr>(
    period ? toDateStr(parseIso(period.endAt)) : weekDates(monday)[6],
  )
  const [endTime, setEndTime] = useState(period ? timeOf(period.endAt) : '20:00')

  const save = () =>
    void tryAction(async () => {
      await provider.upsertCarePeriod({
        ...(period ? { id: period.id } : {}),
        petId: snap.pet.id,
        memberId,
        startAt: atTime(startDate, startTime).toISOString(),
        endAt: atTime(endDate, endTime).toISOString(),
      })
      onClose()
      toast('Garde enregistrée', '🏡')
    })

  const remove = () =>
    void tryAction(async () => {
      if (!period) return
      await provider.deleteCarePeriod(period.id)
      onClose()
      toast('Garde supprimée', '👌')
    })

  return (
    <Sheet open onClose={onClose} title={period ? 'Modifier la garde' : 'Nouvelle garde'}>
      <div className="flex flex-col gap-4">
        <div>
          <span className="mb-1.5 block px-1 text-sm font-bold text-bark-700 dark:text-bark-300">
            Qui garde {snap.pet.name} ?
          </span>
          <div className="flex flex-wrap gap-2">
            {snap.members.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => setMemberId(m.id)}
                className={cx(
                  'flex flex-col items-center gap-1 rounded-2xl bg-white p-2 shadow-sm dark:bg-night-850',
                  memberId === m.id
                    ? 'ring-2 ring-sage-500'
                    : 'ring-1 ring-bark-200/60 dark:ring-night-800',
                )}
              >
                <Avatar member={m} size="md" />
                <span className="text-xs font-bold">{m.name}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Début">
            <TextInput
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
            />
          </Field>
          <Field label="À partir de">
            <TextInput
              type="time"
              value={startTime}
              onChange={(e) => setStartTime(e.target.value)}
            />
          </Field>
          <Field label="Fin">
            <TextInput type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
          </Field>
          <Field label="Jusqu’à">
            <TextInput type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
          </Field>
        </div>
        <Button fullWidth size="lg" onClick={save}>
          {period ? 'Enregistrer' : 'Ajouter la garde'}
        </Button>
        {period && (
          <Button variant="danger" fullWidth onClick={remove}>
            <Trash2 className="size-5" aria-hidden /> Supprimer cette garde
          </Button>
        )}
      </div>
    </Sheet>
  )
}

// ---------------------------------------------------------------------------
// Actions de semaine (duplication, semaine type)
// ---------------------------------------------------------------------------

function WeekActions({ snap, monday }: { snap: AppSnapshot; monday: DateStr }) {
  const toast = useToasts((s) => s.push)
  const [templateSheet, setTemplateSheet] = useState(false)

  const duplicate = () =>
    void tryAction(async () => {
      const n = await provider.duplicateWeek(addDaysStr(monday, -7), monday)
      if (n === 0) toast('La semaine précédente était vide, rien à copier.', '🤷')
      else toast(n === 1 ? '1 créneau copié' : `${n} créneaux copiés`, '📋')
    })

  const saveTemplate = () =>
    void tryAction(async () => {
      await provider.saveWeekTemplate(monday)
      setTemplateSheet(false)
      toast('Semaine type enregistrée', '⭐')
    })

  const applyTemplate = () =>
    void tryAction(async () => {
      const n = await provider.applyWeekTemplate(monday)
      setTemplateSheet(false)
      if (n === 0) toast('La semaine type est vide pour l’instant.', '🤷')
      else toast(n === 1 ? '1 créneau planifié' : `${n} créneaux planifiés`, '📅')
    })

  return (
    <div className="mb-3 flex gap-2">
      <Button variant="soft" size="sm" className="h-auto min-w-0 flex-1 py-2 text-xs" onClick={duplicate}>
        <Copy className="size-4 shrink-0" aria-hidden /> Dupliquer la semaine précédente
      </Button>
      <Button variant="soft" size="sm" className="h-auto shrink-0 py-2 text-xs" onClick={() => setTemplateSheet(true)}>
        <Star className="size-4 shrink-0" aria-hidden /> Semaine type
      </Button>

      <Sheet open={templateSheet} onClose={() => setTemplateSheet(false)} title="Semaine type ⭐">
        <div className="flex flex-col gap-3">
          <p className="text-sm text-bark-600 dark:text-bark-400">
            La semaine type mémorise qui promène {snap.pet.name} à chaque créneau, pour remplir les
            semaines suivantes en un tap.
          </p>
          <Button variant="soft" fullWidth onClick={saveTemplate}>
            <CalendarPlus className="size-5" aria-hidden />
            Enregistrer cette semaine comme semaine type
          </Button>
          <Button fullWidth disabled={!snap.weekTemplate} onClick={applyTemplate}>
            <CalendarCheck className="size-5" aria-hidden />
            Appliquer la semaine type à cette semaine
          </Button>
          {!snap.weekTemplate && (
            <p className="px-1 text-xs text-bark-500">
              Aucune semaine type pour l’instant — commence par enregistrer une semaine bien
              remplie.
            </p>
          )}
        </div>
      </Sheet>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Grille 7 jours × créneaux
// ---------------------------------------------------------------------------

function WeekGrid({
  snap,
  monday,
  templates,
}: {
  snap: AppSnapshot
  monday: DateStr
  templates: SlotTemplate[]
}) {
  const toast = useToasts((s) => s.push)
  const [target, setTarget] = useState<{ date: DateStr; template: SlotTemplate } | null>(null)
  const [scope, setScope] = useState<Scope>('one')
  const dates = weekDates(monday)

  const openPicker = (date: DateStr, template: SlotTemplate) => {
    setScope('one')
    setTarget({ date, template })
  }

  const pick = (memberId: string | null) => {
    if (!target) return
    if (memberId === null && scope !== 'one') return
    void tryAction(async () => {
      if (scope === 'one') {
        await provider.assignWalk(target.date, target.template.id, memberId)
        toast(memberId ? 'Créneau assigné' : 'Créneau libéré', memberId ? '👍' : '👌')
      } else {
        const slotIds = scope === 'template' ? [target.template.id] : templates.map((t) => t.id)
        await provider.assignWalks(
          dates.flatMap((date) =>
            slotIds.map((slotTemplateId) => ({ date, slotTemplateId, memberId: memberId! })),
          ),
        )
        toast('Créneaux assignés', '👍')
      }
      setTarget(null)
    })
  }

  return (
    <div className="flex flex-col gap-2">
      {dates.map((date) => {
        const today = isToday(date)
        return (
          <Card key={date} className={cx('p-3', today && 'ring-2 ring-sage-400')}>
            <div className="mb-2 flex items-center gap-2 px-1">
              <p className="text-sm font-extrabold first-letter:uppercase">
                {formatDayShort(date)}
              </p>
              {today && (
                <span className="rounded-full bg-sage-600 px-2 py-0.5 text-[10px] font-black text-white">
                  Aujourd’hui
                </span>
              )}
            </div>
            <div className="flex gap-2">
              {templates.map((t) => (
                <SlotChip
                  key={t.id}
                  snap={snap}
                  date={date}
                  template={t}
                  onOpen={() => openPicker(date, t)}
                />
              ))}
            </div>
          </Card>
        )
      })}

      <MemberPicker
        open={target !== null}
        onClose={() => setTarget(null)}
        title={
          target
            ? `Qui promène ${snap.pet.name} (${target.template.name.toLowerCase()}) ?`
            : 'Qui promène ?'
        }
        members={snap.members}
        selectedId={
          target ? findWalkSlot(snap.walkSlots, target.date, target.template.id)?.assignedMemberId : undefined
        }
        allowNone={scope === 'one'}
        onPick={pick}
        footer={
          target && (
            <div>
              <p className="mb-1.5 px-1 text-sm font-bold text-bark-700 dark:text-bark-300">
                Appliquer à
              </p>
              <div className="flex gap-1 rounded-2xl bg-bark-100 p-1 dark:bg-night-800">
                {(
                  [
                    { value: 'one', label: 'Ce créneau' },
                    { value: 'template', label: `Tous les ${pluralizeSlot(target.template.name)}` },
                    { value: 'week', label: 'Toute la semaine' },
                  ] as const
                ).map((o) => (
                  <button
                    key={o.value}
                    type="button"
                    onClick={() => setScope(o.value)}
                    className={cx(
                      'flex-1 rounded-xl px-1 py-2 text-xs font-bold transition-colors',
                      scope === o.value
                        ? 'bg-white text-bark-900 shadow-sm dark:bg-night-850 dark:text-cream'
                        : 'text-bark-500 dark:text-bark-400',
                    )}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
              {scope !== 'one' && (
                <p className="mt-1.5 px-1 text-xs text-bark-500">
                  Le membre choisi sera assigné sur les 7 jours de la semaine affichée.
                </p>
              )}
            </div>
          )
        }
      />
    </div>
  )
}

function SlotChip({
  snap,
  date,
  template,
  onOpen,
}: {
  snap: AppSnapshot
  date: DateStr
  template: SlotTemplate
  onOpen: () => void
}) {
  const slot = findWalkSlot(snap.walkSlots, date, template.id)
  const assigned = memberById(snap, slot?.assignedMemberId)
  const done = slot?.status === 'done'
  const hours = `${formatTime(template.startTime)} – ${formatTime(template.endTime)}`

  return (
    <button
      type="button"
      onClick={onOpen}
      title={`${template.name} · ${hours}`}
      aria-label={`${template.name} (${hours}) — ${assigned ? `assigné à ${assigned.name}` : 'personne'}${done ? ', promenade validée' : ''}`}
      className="relative flex flex-1 flex-col items-center gap-1 rounded-2xl bg-bark-50 px-1 py-2 active:bg-sage-50 dark:bg-night-800 dark:active:bg-night-800/60"
    >
      <span className="text-base leading-none" aria-hidden>
        {template.emoji}
      </span>
      <span className="relative">
        {assigned ? (
          <Avatar member={assigned} size="sm" />
        ) : (
          <span className="flex size-8 items-center justify-center rounded-full border-2 border-dashed border-bark-300 text-sm text-bark-400 dark:border-night-800">
            ∅
          </span>
        )}
        {done && (
          <span
            className="absolute -top-1 -right-1.5 flex size-4 items-center justify-center rounded-full bg-sage-600 text-white ring-2 ring-white dark:ring-night-850"
            aria-hidden
          >
            <Check className="size-3" strokeWidth={3.5} />
          </span>
        )}
      </span>
      <span className="max-w-full truncate text-[10px] font-bold text-bark-500 dark:text-bark-400">
        {template.name}
      </span>
      <span className="text-[9px] font-semibold text-bark-400 dark:text-bark-500" aria-hidden>
        {hours.replace(/\s/g, '')}
      </span>
    </button>
  )
}
