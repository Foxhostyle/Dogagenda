import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { ArrowLeft, KeyRound, PlusCircle, Sparkles } from 'lucide-react'
import { provider } from '../data'
import { MEMBER_COLORS, MEMBER_EMOJIS } from '../domain/types'
import { normalizeInviteCode } from '../lib/ids'
import { useApp } from '../store/useApp'
import { useToasts } from '../store/useToasts'
import { Button, Card, Field, TextInput, cx } from '../components/ui'

type Step = 'choice' | 'create' | 'join'

export default function Welcome() {
  const [params] = useSearchParams()
  const [step, setStep] = useState<Step>(params.get('code') ? 'join' : 'choice')

  return (
    <div className="pt-safe mx-auto flex min-h-dvh w-full max-w-lg flex-col px-5 pb-10">
      <header className="flex flex-col items-center gap-2 pt-14 pb-8 text-center">
        <span className="text-6xl" aria-hidden>
          🐕
        </span>
        <h1 className="text-3xl font-black tracking-tight">Dogagenda</h1>
        <p className="text-bark-600 dark:text-bark-400">
          Les promenades et la garde de ton chien,
          <br />
          coordonnées en famille.
        </p>
      </header>
      {step === 'choice' && <ChoiceStep onPick={setStep} />}
      {step === 'create' && <CreateStep onBack={() => setStep('choice')} />}
      {step === 'join' && (
        <JoinStep onBack={() => setStep('choice')} initialCode={params.get('code') ?? ''} />
      )}
    </div>
  )
}

function ChoiceStep({ onPick }: { onPick: (s: Step) => void }) {
  const navigate = useNavigate()
  const adoptSession = useApp((s) => s.adoptSession)
  const error = useToasts((s) => s.error)
  const [busy, setBusy] = useState(false)

  const tryDemo = async () => {
    setBusy(true)
    try {
      const session = await provider.loadDemoData()
      await adoptSession(session)
      navigate('/aujourdhui', { replace: true })
    } catch (e) {
      error(e instanceof Error ? e.message : 'Impossible de charger la démo.')
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <Card onClick={() => onPick('create')} className="flex items-center gap-4 p-5">
        <PlusCircle className="size-8 shrink-0 text-sage-600" aria-hidden />
        <div>
          <p className="text-lg font-extrabold">Créer le foyer de mon chien</p>
          <p className="text-sm text-bark-600 dark:text-bark-400">
            Je suis le premier ici — je crée l’espace et j’invite ma famille.
          </p>
        </div>
      </Card>
      <Card onClick={() => onPick('join')} className="flex items-center gap-4 p-5">
        <KeyRound className="size-8 shrink-0 text-peach-500" aria-hidden />
        <div>
          <p className="text-lg font-extrabold">Rejoindre avec un code</p>
          <p className="text-sm text-bark-600 dark:text-bark-400">
            On m’a partagé un code d’invitation à 6 caractères.
          </p>
        </div>
      </Card>
      {provider.mode === 'demo' && (
        <button
          type="button"
          disabled={busy}
          onClick={() => void tryDemo()}
          className="mt-2 inline-flex items-center justify-center gap-2 py-3 font-bold text-sage-700 active:opacity-70 dark:text-sage-300"
        >
          <Sparkles className="size-5" aria-hidden />
          Découvrir avec la famille de Wint
        </button>
      )}
    </div>
  )
}

function AvatarPicker({
  emoji,
  color,
  onEmoji,
  onColor,
}: {
  emoji: string
  color: string
  onEmoji: (e: string) => void
  onColor: (c: string) => void
}) {
  return (
    <div className="flex flex-col gap-3">
      <Field label="Ton avatar">
        <div className="grid grid-cols-6 gap-2">
          {MEMBER_EMOJIS.map((e) => (
            <button
              key={e}
              type="button"
              aria-label={`Avatar ${e}`}
              onClick={() => onEmoji(e)}
              className={cx(
                'flex aspect-square items-center justify-center rounded-2xl bg-white text-2xl shadow-sm dark:bg-night-850',
                emoji === e && 'ring-2 ring-sage-500',
              )}
            >
              {e}
            </button>
          ))}
        </div>
      </Field>
      <Field label="Ta couleur">
        <div className="flex flex-wrap gap-2.5 px-1">
          {MEMBER_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              aria-label={`Couleur ${c}`}
              onClick={() => onColor(c)}
              className={cx(
                'size-9 rounded-full transition-transform',
                color === c && 'scale-110 ring-2 ring-bark-900 ring-offset-2 ring-offset-cream dark:ring-bark-100 dark:ring-offset-night-900',
              )}
              style={{ backgroundColor: c }}
            />
          ))}
        </div>
      </Field>
    </div>
  )
}

function BackButton({ onBack }: { onBack: () => void }) {
  return (
    <button
      type="button"
      onClick={onBack}
      className="mb-4 inline-flex items-center gap-1.5 self-start font-bold text-bark-500 active:opacity-70"
    >
      <ArrowLeft className="size-4" aria-hidden /> Retour
    </button>
  )
}

function CreateStep({ onBack }: { onBack: () => void }) {
  const navigate = useNavigate()
  const adoptSession = useApp((s) => s.adoptSession)
  const errorToast = useToasts((s) => s.error)
  const [petName, setPetName] = useState('')
  const [petBreed, setPetBreed] = useState('')
  const [name, setName] = useState('')
  const [emoji, setEmoji] = useState<string>(MEMBER_EMOJIS[0])
  const [color, setColor] = useState<string>(MEMBER_COLORS[0])
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    if (!petName.trim() || !name.trim()) {
      errorToast('Il manque le nom du chien ou ton prénom.')
      return
    }
    setBusy(true)
    try {
      const session = await provider.createHousehold({
        memberName: name.trim(),
        memberEmoji: emoji,
        memberColor: color,
        petName: petName.trim(),
        petBreed: petBreed.trim() || undefined,
      })
      await adoptSession(session)
      navigate('/aujourdhui', { replace: true })
    } catch (e) {
      errorToast(e instanceof Error ? e.message : 'Impossible de créer le foyer.')
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <BackButton onBack={onBack} />
      <Field label="Le nom de ton chien">
        <TextInput
          value={petName}
          onChange={(e) => setPetName(e.target.value)}
          placeholder="Wint"
          autoFocus
        />
      </Field>
      <Field label="Sa race (optionnel)">
        <TextInput
          value={petBreed}
          onChange={(e) => setPetBreed(e.target.value)}
          placeholder="Berger australien"
        />
      </Field>
      <Field label="Ton prénom">
        <TextInput value={name} onChange={(e) => setName(e.target.value)} placeholder="Bastien" />
      </Field>
      <AvatarPicker emoji={emoji} color={color} onEmoji={setEmoji} onColor={setColor} />
      <Button size="lg" fullWidth loading={busy} onClick={() => void submit()} className="mt-2">
        C’est parti 🐾
      </Button>
    </div>
  )
}

function JoinStep({ onBack, initialCode }: { onBack: () => void; initialCode: string }) {
  const navigate = useNavigate()
  const adoptSession = useApp((s) => s.adoptSession)
  const errorToast = useToasts((s) => s.error)
  const [code, setCode] = useState(initialCode)
  const [name, setName] = useState('')
  const [emoji, setEmoji] = useState<string>(MEMBER_EMOJIS[1])
  const [color, setColor] = useState<string>(MEMBER_COLORS[1])
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    if (normalizeInviteCode(code).length < 6 || !name.trim()) {
      errorToast('Vérifie le code (6 caractères) et ton prénom.')
      return
    }
    setBusy(true)
    try {
      const session = await provider.joinHousehold({
        inviteCode: code,
        memberName: name.trim(),
        memberEmoji: emoji,
        memberColor: color,
      })
      await adoptSession(session)
      navigate('/aujourdhui', { replace: true })
    } catch (e) {
      errorToast(e instanceof Error ? e.message : 'Impossible de rejoindre le foyer.')
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <BackButton onBack={onBack} />
      <Field label="Code d’invitation" hint="Demande-le au propriétaire du chien.">
        <TextInput
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          placeholder="WINT24"
          autoCapitalize="characters"
          autoCorrect="off"
          maxLength={6}
          className="text-center text-2xl font-black tracking-[0.4em]"
        />
      </Field>
      <Field label="Ton prénom">
        <TextInput value={name} onChange={(e) => setName(e.target.value)} placeholder="Léa" />
      </Field>
      <AvatarPicker emoji={emoji} color={color} onEmoji={setEmoji} onColor={setColor} />
      <Button size="lg" fullWidth loading={busy} onClick={() => void submit()} className="mt-2">
        Rejoindre la famille 👋
      </Button>
    </div>
  )
}
