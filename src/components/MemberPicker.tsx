import type { ReactNode } from 'react'
import { Check } from 'lucide-react'
import type { Member } from '../domain/types'
import { Avatar, Sheet, cx } from './ui'

/**
 * Bottom sheet de choix d'un membre. `allowNone` ajoute « Personne »
 * (désassigner). `footer` permet aux écrans d'ajouter des actions par lot.
 */
export default function MemberPicker({
  open,
  onClose,
  title,
  members,
  selectedId,
  allowNone,
  onPick,
  footer,
}: {
  open: boolean
  onClose: () => void
  title: string
  members: Member[]
  selectedId?: string | null
  allowNone?: boolean
  onPick: (memberId: string | null) => void
  footer?: ReactNode
}) {
  return (
    <Sheet open={open} onClose={onClose} title={title}>
      <div className="flex flex-col gap-2">
        {members.map((m) => (
          <button
            key={m.id}
            type="button"
            onClick={() => onPick(m.id)}
            className={cx(
              'flex items-center gap-3 rounded-2xl bg-white p-3 text-left font-bold shadow-sm active:bg-sage-50 dark:bg-night-850 dark:active:bg-night-800',
              selectedId === m.id && 'ring-2 ring-sage-500',
            )}
          >
            <Avatar member={m} size="md" />
            <span className="flex-1">{m.name}</span>
            {selectedId === m.id && <Check className="size-5 text-sage-600" aria-hidden />}
          </button>
        ))}
        {allowNone && (
          <button
            type="button"
            onClick={() => onPick(null)}
            className="flex items-center gap-3 rounded-2xl border-2 border-dashed border-bark-200 p-3 text-left font-bold text-bark-500 active:bg-bark-50 dark:border-night-800 dark:active:bg-night-800"
          >
            <span className="flex size-10 items-center justify-center rounded-full bg-bark-100 text-lg dark:bg-night-800">
              ∅
            </span>
            Personne
          </button>
        )}
      </div>
      {footer && <div className="mt-4">{footer}</div>}
    </Sheet>
  )
}
