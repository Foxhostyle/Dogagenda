import { NavLink } from 'react-router-dom'
import { CalendarDays, MessageCircle, PawPrint, Sun } from 'lucide-react'
import { useApp } from '../store/useApp'
import { cx } from './ui'

const tabs = [
  { to: '/aujourdhui', label: "Aujourd'hui", icon: Sun },
  { to: '/planning', label: 'Planning', icon: CalendarDays },
  { to: '/discussion', label: 'Discussion', icon: MessageCircle },
  { to: '/wint', label: null, icon: PawPrint }, // libellé = nom de l'animal
]

export default function TabBar() {
  const petName = useApp((s) => s.snap?.pet.name ?? 'Wint')
  return (
    <nav
      aria-label="Navigation principale"
      className="pb-safe fixed inset-x-0 bottom-0 z-40 border-t border-bark-100 bg-white/95 backdrop-blur dark:border-night-800 dark:bg-night-900/95"
    >
      <div className="mx-auto grid max-w-lg grid-cols-4">
        {tabs.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              cx(
                'flex flex-col items-center gap-1 py-2.5 text-[11px] font-bold transition-colors',
                isActive
                  ? 'text-sage-700 dark:text-sage-300'
                  : 'text-bark-400 active:text-bark-600 dark:text-bark-500',
              )
            }
          >
            {({ isActive }) => (
              <>
                <span
                  className={cx(
                    'flex h-7 w-12 items-center justify-center rounded-full transition-colors',
                    isActive && 'bg-sage-100 dark:bg-sage-900/60',
                  )}
                >
                  <Icon className="size-5" aria-hidden />
                </span>
                {label ?? petName}
              </>
            )}
          </NavLink>
        ))}
      </div>
    </nav>
  )
}
