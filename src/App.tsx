import { useEffect, type ReactNode } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import TabBar from './components/TabBar'
import { FullScreenLoader, ToastViewport } from './components/ui'
import Chat from './screens/Chat'
import PetScreen from './screens/Pet'
import Planning from './screens/Planning'
import Today from './screens/Today'
import Welcome from './screens/Welcome'
import { useApp } from './store/useApp'

function Protected({ children }: { children: ReactNode }) {
  const phase = useApp((s) => s.phase)
  if (phase === 'booting') return <FullScreenLoader />
  if (phase !== 'ready') return <Navigate to="/bienvenue" replace />
  return (
    <div className="mx-auto min-h-dvh w-full max-w-lg">
      <div className="pt-safe px-4 pb-32">{children}</div>
      <TabBar />
    </div>
  )
}

export default function App() {
  const { phase, init } = useApp()
  useEffect(() => {
    void init()
  }, [init])

  if (phase === 'booting') return <FullScreenLoader />

  return (
    <>
      <Routes>
        <Route
          path="/bienvenue"
          element={phase === 'ready' ? <Navigate to="/aujourdhui" replace /> : <Welcome />}
        />
        <Route path="/aujourdhui" element={<Protected><Today /></Protected>} />
        <Route path="/planning" element={<Protected><Planning /></Protected>} />
        <Route path="/discussion" element={<Protected><Chat /></Protected>} />
        <Route path="/wint" element={<Protected><PetScreen /></Protected>} />
        <Route
          path="*"
          element={<Navigate to={phase === 'ready' ? '/aujourdhui' : '/bienvenue'} replace />}
        />
      </Routes>
      <ToastViewport />
    </>
  )
}
