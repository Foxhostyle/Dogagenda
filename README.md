# Dogagenda 🐕🐾

**L'application familiale pour coordonner la garde et les promenades de votre chien.**

Qui garde Wint cette semaine ? Qui le promène ce soir ? A-t-il déjà été sorti ce matin ?
Dogagenda remplace les messages éparpillés par une source de vérité unique, partagée par
toute la famille, en temps réel.

<p align="center"><em>PWA installable · React + TypeScript · Supabase · 100 % français</em></p>

## ✨ Fonctionnalités

- **Aujourd'hui** — l'écran que tout le monde ouvre : qui garde le chien en ce moment,
  les créneaux de promenade du jour, validation **en un seul tap** (avec note et photo),
  alerte visuelle si un créneau est passé sans validation.
- **Planning hebdomadaire** — périodes de garde à dates et heures libres, grille
  jours × créneaux avec l'avatar de chaque promeneur, assignation par lot,
  duplication de la semaine précédente, semaine type réutilisable.
- **Remplacements en cascade** — « Je ne peux pas ce soir » : la première personne de
  la liste de priorité (définie par le propriétaire) est notifiée ; si elle refuse ou ne
  répond pas, la demande passe automatiquement à la suivante. Acceptation en un tap,
  planning mis à jour instantanément.
- **Discussion** — fil de conversation familial en temps réel, photos, commentaires
  rattachés à une promenade précise, messages système automatiques (validations,
  remplacements, changements de garde).
- **Notifications push** — rappel avant son créneau (anticipation réglable), promenade
  non validée, rappel de garde la veille, demandes de remplacement. Préférences et
  heures de silence par membre.
- **Calendrier** — export .ics et flux d'abonnement personnel pour retrouver ses gardes
  et promenades dans Google Calendar / Apple Calendar, mis à jour automatiquement.
- **Galerie** — toutes les photos du chien (validations + discussion), regroupées
  automatiquement.
- **Créneaux personnalisables** — le propriétaire définit les créneaux du foyer
  (nom, émoji, horaires) ; matin / après-midi / soir par défaut.
- **Hors-ligne** — l'app s'ouvre sans réseau grâce au service worker.

## 🚀 Essayer immédiatement (mode démo)

Sans aucune configuration, l'application fonctionne **entièrement en local** sur
l'appareil (mode démo) — avec un foyer d'exemple, un sélecteur de membre pour simuler
la famille, et la synchronisation entre les onglets ouverts.

```bash
npm install
npm run dev
```

Ouvrez http://localhost:5173 puis « Découvrir avec la famille de Wint ».

## 🏗️ Mise en production (Supabase)

Pour la vraie synchronisation entre les téléphones de la famille :

1. Suivez le guide pas-à-pas : **[docs/SUPABASE.md](docs/SUPABASE.md)**
   (création du projet, migration SQL, fonctions edge, clés VAPID, cron des rappels).
2. Renseignez les variables d'environnement du frontend :

   ```bash
   cp .env.example .env
   # VITE_SUPABASE_URL=…
   # VITE_SUPABASE_ANON_KEY=…
   # VITE_VAPID_PUBLIC_KEY=…
   ```

3. Déployez sur Vercel ou Netlify (`npm run build` → `dist/`), configurations incluses.
4. Sur chaque téléphone : ouvrir l'URL → « Ajouter à l'écran d'accueil ». C'est tout —
   pas d'App Store, pas de compte à créer, un simple code d'invitation à 6 caractères.

## 🧰 Stack technique

| Couche | Choix |
| --- | --- |
| UI | React 19 + TypeScript strict, Tailwind CSS v4, lucide-react |
| PWA | vite-plugin-pwa (manifest, service worker, précache, icônes) |
| État | zustand + snapshot rechargé sur chaque changement (échelle familiale) |
| Données | Supabase (Postgres + RLS, Realtime, Storage, Edge Functions) — ou mode démo 100 % local (localStorage + IndexedDB + BroadcastChannel) |
| Push | Web Push (VAPID) via fonctions edge + pg_cron |
| Tests | Vitest (logique métier) + Playwright (parcours complets) |

## 📁 Structure

```
src/
  domain/     types, logique métier pure (cascade, créneaux, planning), seed démo
  data/       contrat DataProvider + implémentations démo et Supabase
  store/      zustand (session, snapshot, toasts)
  components/ kit UI (boutons, cartes, sheets, avatars…), TabBar, pickers
  screens/    Aujourd'hui, Planning, Discussion, Wint (profil & réglages), Bienvenue
  lib/        dates françaises, photos, ids, iCal
  pwa/        abonnement Web Push
supabase/
  migrations/ schéma complet + RLS + RPC (cascade atomique)
  functions/  reminders (rappels + escalade), ics (flux calendrier)
tests/        tests unitaires Vitest
e2e/          parcours Playwright
docs/         guide d'installation Supabase
```

## 🧪 Tests

```bash
npm run test        # tests unitaires (logique métier)
npm run build       # typecheck strict + build production + PWA
node e2e/smoke.mjs  # parcours navigateur (nécessite un build + vite preview)
```

## 🗺️ Roadmap v2

Bouton urgence + fiche « SOS », journal santé express (💩🍽️⚠️), mode « promenade en
cours », accès invité dog-sitter à durée limitée, rappels de soins récurrents
(vermifuge, vaccins), alertes canicule, récap mensuel festif, repas & médicaments,
multi-animaux. Le modèle de données les anticipe déjà.

---

Fait avec 🐾 pour Wint.
