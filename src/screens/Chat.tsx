import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Camera, Loader2, Send, X } from 'lucide-react'
import { EmptyState, Avatar, cx } from '../components/ui'
import { provider } from '../data'
import { conversationMessages, type ConversationId } from '../domain/logic'
import type { AppSnapshot, Member, Message, PhotoRef } from '../domain/types'
import { formatDayShort, parseIso, relativeDayLabel, toDateStr, type DateStr } from '../lib/dates'
import { compressImage, usePhotoUrl } from '../lib/photos'
import { memberById, useActiveMember, useApp } from '../store/useApp'
import { tryAction, useToasts } from '../store/useToasts'

export default function Chat() {
  const { snap } = useApp()
  const me = useActiveMember()
  const toast = useToasts((s) => s.push)
  const [searchParams, setSearchParams] = useSearchParams()

  const [text, setText] = useState('')
  const [photo, setPhoto] = useState<PhotoRef | undefined>()
  const [photoBusy, setPhotoBusy] = useState(false)
  /** 'family' = fil du foyer, sinon l'id du membre de la conversation privée. */
  const [conversation, setConversation] = useState<ConversationId>('family')
  const fileRef = useRef<HTMLInputElement>(null)
  const endRef = useRef<HTMLDivElement>(null)
  const firstScroll = useRef(true)
  const stagedUrl = usePhotoUrl(photo)

  // Un commentaire de promenade (« Commenter dans la discussion ») vise
  // toujours le fil familial.
  const hasRefParams = searchParams.has('date')
  useEffect(() => {
    if (hasRefParams) setConversation('family')
  }, [hasRefParams])

  const visibleCount =
    snap && me ? conversationMessages(snap.messages, me.id, conversation).length : 0
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: firstScroll.current ? 'auto' : 'smooth' })
    firstScroll.current = false
  }, [visibleCount, conversation])

  if (!snap || !me) return null

  const refDate = searchParams.get('date')
  const refSlotTemplateId = searchParams.get('slot')
  const refTemplate = refSlotTemplateId
    ? snap.slotTemplates.find((t) => t.id === refSlotTemplateId)
    : undefined

  const clearRef = () => setSearchParams({}, { replace: true })

  const onFile = async (file: File | undefined) => {
    if (!file) return
    setPhotoBusy(true)
    await tryAction(async () => {
      const blob = await compressImage(file)
      setPhoto(await provider.savePhoto(blob))
    })
    setPhotoBusy(false)
    if (fileRef.current) fileRef.current.value = ''
  }

  const send = () => {
    const body = text.trim()
    if (!body && !photo) return
    const hadPhoto = Boolean(photo)
    const isFamily = conversation === 'family'
    void tryAction(async () => {
      await provider.sendMessage({
        text: body,
        ...(photo ? { photo } : {}),
        ...(isFamily ? {} : { recipientId: conversation }),
        ...(isFamily && refDate ? { refDate } : {}),
        ...(isFamily && refDate && refSlotTemplateId ? { refSlotTemplateId } : {}),
      })
      setText('')
      setPhoto(undefined)
      if (refDate || refSlotTemplateId) clearRef()
      if (hadPhoto) toast('Photo envoyée', '📸')
    })
  }

  const others = snap.members.filter((m) => m.id !== me.id)
  const partner = conversation === 'family' ? null : memberById(snap, conversation)
  const visible = conversationMessages(snap.messages, me.id, conversation)

  // Groupes de messages par jour (déjà triés par date).
  const groups: { day: DateStr; items: Message[] }[] = []
  for (const m of visible) {
    const day = toDateStr(parseIso(m.createdAt))
    const last = groups[groups.length - 1]
    if (last && last.day === day) last.items.push(m)
    else groups.push({ day, items: [m] })
  }

  return (
    <div className="animate-fade">
      <header className="pt-6 pb-2">
        <h1 className="text-2xl font-black tracking-tight">Discussion</h1>
        <p className="text-sm font-semibold text-bark-500 dark:text-bark-400">
          {partner
            ? `En privé avec ${partner.name} 🤫`
            : `Le fil de la famille de ${snap.pet.name} 🐾`}
        </p>
      </header>

      {/* Sélecteur de conversation : la famille + chaque membre en privé. */}
      {others.length > 0 && (
        <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-2">
          <button
            type="button"
            onClick={() => setConversation('family')}
            className={cx(
              'flex shrink-0 items-center gap-1.5 rounded-full px-3.5 py-2 text-sm font-bold transition-colors',
              conversation === 'family'
                ? 'bg-sage-600 text-white'
                : 'bg-white text-bark-600 shadow-sm ring-1 ring-bark-200/60 dark:bg-night-850 dark:text-bark-300 dark:ring-night-800',
            )}
          >
            <span aria-hidden>🐾</span> Famille
          </button>
          {others.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => setConversation(m.id)}
              className={cx(
                'flex shrink-0 items-center gap-1.5 rounded-full py-1.5 pr-3.5 pl-1.5 text-sm font-bold transition-colors',
                conversation === m.id
                  ? 'bg-sage-600 text-white'
                  : 'bg-white text-bark-600 shadow-sm ring-1 ring-bark-200/60 dark:bg-night-850 dark:text-bark-300 dark:ring-night-800',
              )}
            >
              <Avatar member={m} size="xs" />
              {m.name}
            </button>
          ))}
        </div>
      )}

      {groups.length === 0 ? (
        <div className="pt-6 pb-36">
          <EmptyState
            emoji={partner ? '🤫' : '💬'}
            title={partner ? `Pas encore de messages avec ${partner.name}` : 'Pas encore de messages'}
            text={
              partner
                ? 'Cette conversation reste entre vous deux.'
                : `Lance la conversation : un petit mot, une photo de ${snap.pet.name}… tout fait plaisir !`
            }
          />
        </div>
      ) : (
        <div className="flex flex-col gap-3 pt-2 pb-36">
          {groups.map((g) => (
            <div key={g.day} className="flex flex-col gap-3">
              <p className="mt-2 text-center text-xs font-bold text-bark-400 first-letter:uppercase dark:text-bark-500">
                {relativeDayLabel(g.day)}
              </p>
              {g.items.map((m) =>
                m.kind === 'system' ? (
                  <SystemMessage key={m.id} message={m} />
                ) : (
                  <UserMessage key={m.id} message={m} snap={snap} me={me} />
                ),
              )}
            </div>
          ))}
          <div ref={endRef} aria-hidden />
        </div>
      )}

      {/* Composer, posé juste au-dessus de la barre d’onglets */}
      <div className="fixed inset-x-0 bottom-[calc(4.25rem+env(safe-area-inset-bottom))] z-30 mx-auto w-full max-w-lg px-4 pb-2">
        {refDate && (
          <div className="mb-2 flex items-center gap-2 rounded-2xl bg-sage-100 px-3 py-2 text-xs font-bold text-sage-800 shadow-sm dark:bg-sage-900/80 dark:text-sage-200">
            <span className="flex-1 truncate">
              En réponse à : {refTemplate ? `${refTemplate.emoji} ${refTemplate.name}` : 'la journée'}{' '}
              · {relativeDayLabel(refDate)}
            </span>
            <button
              type="button"
              aria-label="Retirer le contexte"
              onClick={clearRef}
              className="flex size-6 shrink-0 items-center justify-center rounded-full active:bg-sage-200 dark:active:bg-sage-900"
            >
              <X className="size-4" />
            </button>
          </div>
        )}
        {photo && stagedUrl && (
          <div className="mb-2 flex">
            <div className="relative">
              <img
                src={stagedUrl}
                alt="Photo à envoyer"
                className="size-20 rounded-2xl object-cover shadow-lg"
              />
              <button
                type="button"
                aria-label="Retirer la photo"
                onClick={() => setPhoto(undefined)}
                className="absolute -top-2 -right-2 flex size-7 items-center justify-center rounded-full bg-bark-900 text-white shadow"
              >
                <X className="size-4" />
              </button>
            </div>
          </div>
        )}
        <div className="flex items-center gap-1.5 rounded-2xl bg-white p-1.5 shadow-lg shadow-bark-200/60 ring-1 ring-bark-200/60 dark:bg-night-850 dark:shadow-none dark:ring-night-800">
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => void onFile(e.target.files?.[0])}
          />
          <button
            type="button"
            aria-label="Ajouter une photo"
            disabled={photoBusy}
            onClick={() => fileRef.current?.click()}
            className="flex size-10 shrink-0 items-center justify-center rounded-full text-bark-500 active:bg-bark-100 dark:text-bark-400 dark:active:bg-night-800"
          >
            {photoBusy ? (
              <Loader2 className="size-5 animate-spin" aria-hidden />
            ) : (
              <Camera className="size-5" aria-hidden />
            )}
          </button>
          <input
            type="text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                send()
              }
            }}
            placeholder={partner ? `Écris à ${partner.name}…` : 'Écris un petit mot…'}
            aria-label="Message"
            className="h-10 min-w-0 flex-1 bg-transparent px-1 text-base font-medium placeholder:text-bark-400 focus:outline-none dark:placeholder:text-bark-600"
          />
          <button
            type="button"
            aria-label="Envoyer"
            disabled={(!text.trim() && !photo) || photoBusy}
            onClick={send}
            className="flex size-10 shrink-0 items-center justify-center rounded-full bg-sage-600 text-white transition-colors active:bg-sage-700 disabled:bg-sage-300 dark:disabled:bg-sage-900"
          >
            <Send className="size-5" aria-hidden />
          </button>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

/** Photo d'un message (composant dédié : usePhotoUrl est un hook). */
function MessagePhoto({ photo, alt }: { photo: PhotoRef; alt: string }) {
  const url = usePhotoUrl(photo)
  if (!url) return null
  return <img src={url} alt={alt} className="max-h-56 w-full rounded-2xl object-cover" />
}

function SystemMessage({ message }: { message: Message }) {
  return (
    <div className="flex flex-col items-center gap-2">
      <p className="max-w-[90%] rounded-full bg-bark-100/70 px-3.5 py-1.5 text-center text-xs font-bold text-bark-500 dark:bg-night-800 dark:text-bark-400">
        {message.text}
      </p>
      {message.photo && (
        <div className="w-3/4">
          <MessagePhoto photo={message.photo} alt="Photo partagée" />
        </div>
      )}
    </div>
  )
}

/** Chip de contexte « ↳ Matin 🌅 · jeu. 3 juil. » au-dessus du texte. */
function RefChip({
  snap,
  message,
  mine,
}: {
  snap: AppSnapshot
  message: Message
  mine: boolean
}) {
  if (!message.refDate) return null
  const template = message.refSlotTemplateId
    ? snap.slotTemplates.find((t) => t.id === message.refSlotTemplateId)
    : undefined
  return (
    <p
      className={cx(
        'mb-1 text-[11px] font-bold',
        mine ? 'text-white/80' : 'text-bark-500 dark:text-bark-400',
      )}
    >
      <span aria-hidden>↳ </span>
      {template ? `${template.emoji} ${template.name} · ` : ''}
      {formatDayShort(message.refDate)}
    </p>
  )
}

function UserMessage({ message, snap, me }: { message: Message; snap: AppSnapshot; me: Member }) {
  const mine = message.authorId === me.id
  const author = memberById(snap, message.authorId)

  if (mine) {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-3xl rounded-br-lg bg-sage-600 px-4 py-2.5 text-white">
          <RefChip snap={snap} message={message} mine />
          {message.photo && (
            <div className={cx(message.text && 'mb-1.5')}>
              <MessagePhoto photo={message.photo} alt="Photo envoyée" />
            </div>
          )}
          {message.text && <p className="text-[15px] leading-snug font-medium">{message.text}</p>}
        </div>
      </div>
    )
  }

  return (
    <div className="flex items-end gap-2">
      <Avatar member={author} size="sm" />
      <div className="max-w-[80%]">
        <p className="mb-0.5 px-1.5 text-[11px] font-bold text-bark-500 dark:text-bark-400">
          {author?.name ?? 'Ancien membre'}
        </p>
        <div className="rounded-3xl rounded-bl-lg bg-white px-4 py-2.5 shadow-sm shadow-bark-200/40 dark:bg-night-850 dark:shadow-none dark:ring-1 dark:ring-night-800">
          <RefChip snap={snap} message={message} mine={false} />
          {message.photo && (
            <div className={cx(message.text && 'mb-1.5')}>
              <MessagePhoto photo={message.photo} alt={`Photo de ${author?.name ?? 'la famille'}`} />
            </div>
          )}
          {message.text && <p className="text-[15px] leading-snug font-medium">{message.text}</p>}
        </div>
      </div>
    </div>
  )
}
