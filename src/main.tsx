import '@fontsource-variable/nunito/index.css'
import './index.css'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, HashRouter } from 'react-router-dom'
import App from './App.tsx'

/**
 * Variante « page unique » (VITE_ARTIFACT=1) : démo hébergée en un seul
 * fichier HTML — routage par hash (pas de serveur) et pas de service worker.
 */
const isArtifact = import.meta.env.VITE_ARTIFACT === '1'
if (!isArtifact) {
  void import('virtual:pwa-register').then(({ registerSW }) => registerSW({ immediate: true }))
}
const Router = isArtifact ? HashRouter : BrowserRouter

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Router>
      <App />
    </Router>
  </StrictMode>,
)
