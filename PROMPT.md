# Prompt — Dogagenda 🐕

> Prompt à copier-coller dans Claude Code pour générer l'application complète.
> Élaboré le 2026-07-03 pour coordonner la garde et les promenades de Wint en famille.

---

Crée une application mobile complète appelée **Dogagenda**, une PWA installable sur téléphone (iOS et Android) qui permet à une famille de coordonner la garde et les promenades d'un chien nommé **Wint**.

## Contexte et objectif

Plusieurs membres d'une même famille se relaient pour garder Wint et le promener. Aujourd'hui tout se fait de tête ou par messages éparpillés. L'application doit devenir la source de vérité unique : qui garde Wint cette semaine, qui le promène à chaque créneau (matin / après-midi / soir), est-ce que la promenade a bien eu lieu, et un espace de discussion pour se coordonner. L'application doit être **simple, moderne et jolie** — utilisable par tous les âges, chaque action courante en un seul tap.

## Stack technique imposée

- **Frontend** : React + TypeScript + Vite, Tailwind CSS. PWA installable via `vite-plugin-pwa` (manifest complet, service worker, icônes, écran "Ajouter à l'écran d'accueil" avec instructions iOS/Android si l'app n'est pas encore installée).
- **Backend** : Supabase — Postgres, Realtime (synchronisation instantanée entre les téléphones), Storage (photos), Edge Functions (envoi des notifications push).
- **Notifications push** : Web Push API avec clés VAPID, déclenchées par des Edge Functions Supabase (planifiées via `pg_cron` pour les rappels).
- **Déploiement** : prêt pour Vercel ou Netlify (fournis la config). Fournis aussi le fichier de migrations SQL Supabase et un README d'installation pas-à-pas (créer le projet Supabase, renseigner les variables d'env, générer les clés VAPID, déployer).
- Mobile-first exclusivement : conçois pour un écran de téléphone, l'affichage desktop est secondaire.

## Comptes et invitation (sans friction)

- Pas d'email ni de mot de passe. Le premier utilisateur crée le **foyer** de Wint et obtient un **code d'invitation** (6 caractères) + un lien de partage.
- Un nouveau membre ouvre le lien ou saisit le code, entre son **prénom**, choisit un **avatar/couleur**, et il est dans le foyer. Utilise l'auth anonyme de Supabase avec persistance locale pour que la session survive aux redémarrages.
- Rôles : **propriétaire** (crée le foyer, peut gérer les membres et le profil de Wint) et **membre** (tout le reste). Garde le modèle extensible à plusieurs animaux et plusieurs foyers, mais l'UI de la v1 est centrée sur un seul chien.
- Sécurise avec des politiques RLS : un utilisateur ne voit que les données de son foyer.

## Modèle de données (adapte si besoin)

- `households` : id, nom, code d'invitation.
- `members` : id, household_id, prénom, avatar/couleur, rôle, subscription push.
- `pets` : id, household_id, nom, photo, race, date de naissance, notes.
- `care_weeks` : household_id, pet_id, semaine (date du lundi), member_id gardien. Une semaine = un gardien principal.
- `walk_slots` : pet_id, date, créneau (`morning` | `afternoon` | `evening`), member_id assigné, statut (`pending` | `done` | `skipped`), validé par, validé à, note, photo éventuelle.
- `messages` : fil de discussion du foyer — texte, photo éventuelle, auteur, et référence optionnelle à un jour ou à un `walk_slot` (pour commenter une promenade précise).
- `swap_requests` : demandes de remplacement — walk_slot ou care_week concerné, demandeur, message, statut (`open` | `accepted` | `cancelled`), accepté par.

## Écrans et fonctionnalités

### 1. Aujourd'hui (écran d'accueil)
- En-tête avec la photo et le nom de Wint, et **qui le garde cette semaine** (avatar bien visible).
- Les **3 créneaux du jour** en grosses cartes : promeneur assigné, statut. Validation **en un seul tap** ("Wint a été promené ✅") avec l'heure et l'auteur enregistrés automatiquement ; possibilité d'ajouter une note et une **photo** juste après la validation. Un créneau passé non validé apparaît clairement en alerte visuelle.
- N'importe quel membre peut valider un créneau, même s'il n'était pas assigné (la réalité d'une famille) — l'app enregistre qui a réellement promené.

### 2. Planning (semaine)
- Vue hebdomadaire : le **gardien de la semaine** en tête, puis la grille 7 jours × 3 créneaux avec l'avatar du promeneur assigné sur chaque case.
- Édition simple : taper une case → choisir un membre. Assignation par lot ("toute la semaine", "tous les matins").
- Bouton **"Dupliquer la semaine précédente"** et notion de **semaine type** réutilisable pour ne pas tout ressaisir.
- Navigation entre les semaines passées et futures.

### 3. Demande de remplacement
- Depuis un créneau qui m'est assigné : **"Je ne peux pas"** → petit message optionnel → tous les autres membres reçoivent une notification push.
- Un membre accepte **en un tap** : le planning se met à jour instantanément chez tout le monde, et un message automatique apparaît dans la discussion ("Léa remplace Bastien pour la promenade du soir 🙌").

### 4. Discussion
- Fil de conversation du foyer, en temps réel (Supabase Realtime), avec envoi de **photos**.
- Les événements importants s'insèrent automatiquement dans le fil : promenade validée avec photo, remplacement accepté, changement de gardien.
- Depuis une promenade, on peut laisser un **commentaire rattaché** ("il a boité un peu au retour") qui apparaît dans le fil avec le contexte.

### 5. Profil de Wint & réglages
- Photo, nom, race, âge, notes libres (véto, particularités).
- Liste des membres du foyer, code d'invitation à partager (bouton copier + partage natif `navigator.share`).
- Réglages de notifications par membre (activer/désactiver chaque type de rappel, choisir l'heure limite de chaque créneau).

### Notifications push (essentielles)
1. **Rappel de créneau** : si la promenade n'est pas validée à l'heure limite du créneau (configurable, ex. 10h / 16h / 21h), notifier le promeneur assigné ; si toujours rien 45 min plus tard, notifier tout le foyer.
2. **Rappel de garde** : le dimanche soir, "C'est toi qui gardes Wint la semaine prochaine".
3. **Remplacement** : nouvelle demande → tout le monde ; demande acceptée → le demandeur.
4. **Discussion** : nouveau message (désactivable).
Gère proprement la demande de permission (au bon moment, pas à l'ouverture), et le fallback si les push ne sont pas disponibles (badge dans l'app).

### Hors-ligne
- L'app s'ouvre et affiche les dernières données connues sans réseau ; une validation faite hors-ligne est mise en file et synchronisée au retour du réseau, avec un indicateur discret d'état de synchro.

## Design

- Style **simple, moderne, chaleureux**. Palette douce (à dominante crème/vert sauge ou pêche, à ta discrétion), coins très arrondis, ombres légères, généreuse hiérarchie typographique. **Mode sombre** automatique.
- La photo de Wint est l'élément affectif central de l'app (accueil, en-tête).
- Grosses zones tactiles, une action = un tap, micro-animations de satisfaction à la validation (confetti léger ou patte animée 🐾).
- Barre d'onglets en bas : **Aujourd'hui · Planning · Discussion · Wint**.
- Textes de l'interface **en français**, ton léger et familial ("Wint a été promené !", "À qui le tour ?").
- États vides soignés (première ouverture, semaine non planifiée) qui guident l'utilisateur vers l'action.

## Qualité et critères d'acceptation

- TypeScript strict, composants réutilisables, code lisible.
- Deux téléphones ouverts en même temps voient les changements de l'autre en moins de 2 secondes (Realtime).
- Lighthouse PWA : installable, service worker actif, icônes et splash screens corrects.
- Fournis des données de démonstration (seed) pour tester immédiatement : un foyer, Wint, 3 membres, une semaine planifiée.
- README complet : installation, configuration Supabase (SQL fourni), génération des clés VAPID, déploiement, et comment inviter la famille.

Commence par mettre en place le projet, le schéma Supabase et l'écran "Aujourd'hui", puis le planning, la discussion, les remplacements, et enfin les notifications push.
