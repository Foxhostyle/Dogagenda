/**
 * Kit UI partagé — gros boutons tactiles, cartes très arrondies, bottom
 * sheets. Toute nouvelle vue doit se composer à partir de ces briques.
 */
import { useEffect, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Loader2, X } from 'lucide-react'
import type { Member } from '../domain/types'
import { useToasts } from '../store/useToasts'

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ')
}

// ---------------------------------------------------------------------------
// Boutons
// ---------------------------------------------------------------------------

type ButtonVariant = 'primary' | 'peach' | 'soft' | 'ghost' | 'danger'

const buttonStyles: Record<ButtonVariant, string> = {
  primary:
    'bg-sage-600 text-white active:bg-sage-700 disabled:bg-sage-300 dark:disabled:bg-sage-900',
  peach: 'bg-peach-500 text-white active:bg-peach-600 disabled:bg-peach-200',
  soft: 'bg-sage-100 text-sage-800 active:bg-sage-200 dark:bg-sage-900/60 dark:text-sage-200 dark:active:bg-sage-900',
  ghost:
    'bg-transparent text-sage-700 active:bg-sage-100 dark:text-sage-300 dark:active:bg-night-800',
  danger: 'bg-red-50 text-red-700 active:bg-red-100 dark:bg-red-950/50 dark:text-red-300',
}

export function Button({
  variant = 'primary',
  size = 'md',
  fullWidth,
  loading,
  className,
  children,
  disabled,
  ...rest
}: {
  variant?: ButtonVariant
  size?: 'sm' | 'md' | 'lg'
  fullWidth?: boolean
  loading?: boolean
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      disabled={disabled || loading}
      className={cx(
        'inline-flex items-center justify-center gap-2 rounded-2xl font-bold transition-colors select-none',
        size === 'sm' && 'h-9 px-3 text-sm',
        size === 'md' && 'h-12 px-5 text-base',
        size === 'lg' && 'h-14 px-6 text-lg',
        fullWidth && 'w-full',
        buttonStyles[variant],
        className,
      )}
      {...rest}
    >
      {loading && <Loader2 className="size-5 animate-spin" aria-hidden />}
      {children}
    </button>
  )
}

// ---------------------------------------------------------------------------
// Cartes & structure
// ---------------------------------------------------------------------------

export function Card({
  className,
  children,
  onClick,
}: {
  className?: string
  children: ReactNode
  onClick?: () => void
}) {
  const cls = cx(
    'rounded-3xl bg-white p-4 text-left shadow-sm shadow-bark-200/40 dark:bg-night-850 dark:shadow-none dark:ring-1 dark:ring-night-800',
    onClick && 'w-full cursor-pointer transition-transform active:scale-[0.99]',
    className,
  )
  // Une carte cliquable doit être un vrai bouton (clavier, lecteurs d'écran).
  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={cls}>
        {children}
      </button>
    )
  }
  return <div className={cls}>{children}</div>
}

export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mt-6 mb-2 flex items-end justify-between px-1">
      <h2 className="text-sm font-extrabold tracking-wide text-bark-500 uppercase dark:text-bark-400">
        {children}
      </h2>
      {action}
    </div>
  )
}

export function EmptyState({
  emoji,
  title,
  text,
  action,
}: {
  emoji: string
  title: string
  text?: string
  action?: ReactNode
}) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-3xl border-2 border-dashed border-bark-200 px-6 py-10 text-center dark:border-night-800">
      <div className="text-4xl" aria-hidden>
        {emoji}
      </div>
      <p className="font-bold">{title}</p>
      {text && <p className="text-sm text-bark-600 dark:text-bark-400">{text}</p>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  )
}

export function FullScreenLoader() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-3">
      <span className="text-5xl" aria-hidden>
        🐾
      </span>
      <Loader2 className="size-6 animate-spin text-sage-500" aria-label="Chargement" />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Avatar de membre
// ---------------------------------------------------------------------------

export function Avatar({
  member,
  size = 'md',
  ring,
}: {
  member: Member | null
  size?: 'xs' | 'sm' | 'md' | 'lg'
  ring?: boolean
}) {
  const sizes = { xs: 'size-6 text-xs', sm: 'size-8 text-base', md: 'size-10 text-lg', lg: 'size-14 text-2xl' }
  return (
    <span
      title={member?.name}
      className={cx(
        'inline-flex shrink-0 items-center justify-center rounded-full',
        sizes[size],
        ring && 'ring-2 ring-white dark:ring-night-850',
      )}
      style={{ backgroundColor: member ? `${member.color}26` : 'var(--color-bark-100)' }}
    >
      <span aria-hidden>{member?.emoji ?? '❔'}</span>
    </span>
  )
}

export function MemberTag({ member, size = 'sm' }: { member: Member | null; size?: 'xs' | 'sm' }) {
  return (
    <span className="inline-flex items-center gap-1.5 font-semibold">
      <Avatar member={member} size={size === 'xs' ? 'xs' : 'sm'} />
      <span className={cx(size === 'xs' ? 'text-xs' : 'text-sm')}>
        {member?.name ?? 'Ancien membre'}
      </span>
    </span>
  )
}

// ---------------------------------------------------------------------------
// Champs de formulaire
// ---------------------------------------------------------------------------

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block">
      <span className="mb-1.5 block px-1 text-sm font-bold text-bark-700 dark:text-bark-300">
        {label}
      </span>
      {children}
      {hint && <span className="mt-1 block px-1 text-xs text-bark-500">{hint}</span>}
    </label>
  )
}

export const inputClass =
  'w-full rounded-2xl border-0 bg-white px-4 py-3 text-base font-medium shadow-sm shadow-bark-200/40 ring-1 ring-bark-200/60 placeholder:text-bark-400 focus:ring-2 focus:ring-sage-500 focus:outline-none dark:bg-night-850 dark:ring-night-800 dark:placeholder:text-bark-600'

export function TextInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cx(inputClass, props.className)} />
}

export function TextArea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea rows={3} {...props} className={cx(inputClass, 'resize-none', props.className)} />
}

export function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  label?: string
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cx(
        'relative h-7 w-12 shrink-0 rounded-full transition-colors',
        checked ? 'bg-sage-600' : 'bg-bark-300 dark:bg-night-800',
      )}
    >
      {/* Position et déplacement en rem : reste aligné même quand l'utilisateur
          agrandit la taille de police du téléphone (accessibilité Android). */}
      <span
        className={cx(
          'absolute top-0.5 left-0.5 size-6 rounded-full bg-white shadow transition-transform',
          checked ? 'translate-x-5' : 'translate-x-0',
        )}
      />
    </button>
  )
}

// ---------------------------------------------------------------------------
// Bottom sheet
// ---------------------------------------------------------------------------

export function Sheet({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean
  onClose: () => void
  title?: string
  children: ReactNode
}) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    // Focus initial dans le dialogue, verrouillage du scroll de fond,
    // piège à Tab et restauration du focus à la fermeture.
    const previouslyFocused = document.activeElement as HTMLElement | null
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    ref.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      if (e.key === 'Tab' && ref.current) {
        const focusables = ref.current.querySelectorAll<HTMLElement>(
          'button, [href], input, textarea, select, [tabindex]:not([tabindex="-1"])',
        )
        if (focusables.length === 0) return
        const first = focusables[0]
        const last = focusables[focusables.length - 1]
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault()
          last.focus()
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault()
          first.focus()
        }
      }
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = previousOverflow
      previouslyFocused?.focus?.()
    }
  }, [open, onClose])

  if (!open) return null
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center">
      <div className="animate-fade absolute inset-0 bg-bark-950/40" onClick={onClose} aria-hidden />
      <div
        ref={ref}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="animate-sheet pb-safe relative z-10 max-h-[88dvh] w-full max-w-lg overflow-y-auto rounded-t-3xl bg-cream p-5 outline-none dark:bg-night-900"
      >
        <div className="mb-3 flex items-center justify-between gap-4">
          <h2 className="text-lg font-extrabold">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fermer"
            className="flex size-9 items-center justify-center rounded-full bg-bark-100 text-bark-600 active:bg-bark-200 dark:bg-night-800 dark:text-bark-300"
          >
            <X className="size-5" />
          </button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  )
}

// ---------------------------------------------------------------------------
// Toasts + confettis de pattes
// ---------------------------------------------------------------------------

export function ToastViewport() {
  const { toasts, dismiss } = useToasts()
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-24 z-[60] flex flex-col items-center gap-2 px-4">
      {toasts.map((t) => (
        <button
          key={t.id}
          type="button"
          onClick={() => dismiss(t.id)}
          className={cx(
            'animate-toast pointer-events-auto max-w-sm rounded-2xl px-4 py-3 text-sm font-bold text-white shadow-lg',
            t.tone === 'error' ? 'bg-red-600' : 'bg-bark-900 dark:bg-sage-700',
          )}
        >
          {t.emoji && (
            <span className="mr-1.5" aria-hidden>
              {t.emoji}
            </span>
          )}
          {t.text}
        </button>
      ))}
    </div>
  )
}

/** Petite pluie de pattes 🐾 au moment d'une validation. */
export function PawBurst({ burstKey }: { burstKey: number }) {
  if (burstKey === 0) return null
  const paws = Array.from({ length: 7 }, (_, i) => i)
  return (
    <div key={burstKey} className="pointer-events-none fixed inset-x-0 bottom-32 z-[55] flex justify-center">
      {paws.map((i) => (
        <span
          key={i}
          className="animate-paw absolute text-2xl"
          style={{
            left: `calc(50% + ${(i - 3) * 34}px)`,
            animationDelay: `${i * 55}ms`,
            ['--paw-rot' as string]: `${(i - 3) * 14}deg`,
          }}
          aria-hidden
        >
          🐾
        </span>
      ))}
    </div>
  )
}
