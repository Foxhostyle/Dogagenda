# Prompt — Dogagenda 🐕

> Prompt à copier-coller dans Claude Code pour générer l'application complète.
> Élaboré le 2026-07-03 pour coordonner la garde et les promenades de Wint en famille.

---

Crée une application mobile complète appelée **Dogagenda**, une PWA installable sur téléphone (iOS et Android) qui permet à une famille de coordonner la garde et les promenades d'un chien nommé **Wint**.

## Contexte et objectif

Plusieurs membres d'une même famille se relaient pour garder Wint et le promener. Aujourd'hui tout se fait de tête ou par messages éparpillés. L'application doit devenir la source de vérité unique : qui garde Wint et sur quelle période (avec dates et heures), qui le promène à chaque créneau de la journée (créneaux définis par le foyer, par défaut matin / après-midi / soir avec leurs horaires), est-ce que la promenade a bien eu lieu, et un espace de discussion pour se coordonner. L'application doit être **simple, moderne et jolie** — utilisable par tous les âges, chaque action courante en un seul tap.

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
- `members` : id, household_id, prénom, avatar/couleur, rôle, **rang de priorité** (ordre défini par le propriétaire pour les notifications en cascade), subscription push, jeton secret de flux calendrier.
- `pets` : id, household_id, nom, photo, race, date de naissance, notes.
- `slot_templates` : les créneaux de promenade du foyer, **définis par le propriétaire** — nom ("Matin", "Midi", "Soir"…), heure de début, heure de fin, ordre d'affichage, actif/inactif. Par défaut, trois créneaux (Matin 7h–9h, Après-midi 14h–17h, Soir 19h–21h) créés à l'initialisation, entièrement modifiables : renommer, changer les horaires, en ajouter ou en supprimer.
- `care_periods` : périodes de garde — pet_id, member_id gardien, **date + heure de début, date + heure de fin** (une garde peut durer un week-end, une semaine, ou commencer un mercredi à 18h). Empêche les chevauchements.
- `walk_slots` : pet_id, date, slot_template_id, member_id assigné, statut (`pending` | `done` | `skipped`), validé par, validé à, note, photo éventuelle.
- `messages` : fil de discussion du foyer — texte, photo éventuelle, auteur, et référence optionnelle à un jour ou à un `walk_slot` (pour commenter une promenade précise).
- `swap_requests` : demandes de remplacement — walk_slot ou care_period concerné, demandeur, message, statut (`open` | `accepted` | `cancelled` | `exhausted`), accepté par, **position courante dans la cascade** et historique des refus (qui a été notifié, qui a refusé, quand).
- `notification_prefs` : préférences de rappel **par membre** — activation par type de notification, délai d'anticipation des rappels (ex. "préviens-moi 30 min avant mon créneau"), heures de silence.

## Écrans et fonctionnalités

### 1. Aujourd'hui (écran d'accueil)
- En-tête avec la photo et le nom de Wint, et **qui le garde en ce moment** (avatar bien visible, avec la fin de la période de garde).
- Les **créneaux du jour** (tels que définis par le foyer, avec leurs horaires) en grosses cartes : promeneur assigné, statut. Validation **en un seul tap** ("Wint a été promené ✅") avec l'heure et l'auteur enregistrés automatiquement ; possibilité d'ajouter une note et une **photo** juste après la validation. Un créneau passé non validé apparaît clairement en alerte visuelle.
- N'importe quel membre peut valider un créneau, même s'il n'était pas assigné (la réalité d'une famille) — l'app enregistre qui a réellement promené.

### 2. Planning (semaine)
- Vue hebdomadaire : les **périodes de garde** en tête (bandeau montrant qui garde Wint, avec les heures de début et de fin si la garde ne couvre pas des journées entières), puis la grille 7 jours × créneaux du foyer avec l'avatar du promeneur assigné sur chaque case. Chaque créneau affiche son nom et sa plage horaire.
- Édition simple : taper une case → choisir un membre. Assignation par lot ("toute la semaine", "tous les matins"). Créer ou modifier une **période de garde** en choisissant le gardien, les dates et les heures de début/fin.
- Bouton **"Dupliquer la semaine précédente"** et notion de **semaine type** réutilisable pour ne pas tout ressaisir.
- Navigation entre les semaines passées et futures.

### 3. Demande de remplacement — notification en cascade
- Le propriétaire définit un **ordre de priorité des intervenants** (liste réordonnable par glisser-déposer dans les réglages).
- Depuis un créneau ou une garde qui m'est assigné : **"Je ne peux pas"** → petit message optionnel → la demande part **en cascade** : seule la **première personne** de la liste de priorité (hors demandeur) reçoit la notification, avec deux boutons **Accepter / Refuser** directement dans la notification et dans l'app.
- Si elle **refuse** — ou ne répond pas dans un délai configurable (ex. 30 min) — la **personne suivante** de la liste est notifiée, et ainsi de suite. Si toute la liste est épuisée sans accord, tout le foyer est notifié et la demande reste ouverte à tous.
- Dès qu'un membre accepte : le planning se met à jour instantanément chez tout le monde, la cascade s'arrête, et un message automatique apparaît dans la discussion ("Léa remplace Bastien pour la promenade du soir 🙌"). Le demandeur voit en temps réel où en est la cascade (qui a été sollicité, qui a refusé).

### 4. Discussion
- Fil de conversation du foyer, en temps réel (Supabase Realtime), avec envoi de **photos**.
- Les événements importants s'insèrent automatiquement dans le fil : promenade validée avec photo, remplacement accepté, changement de gardien.
- Depuis une promenade, on peut laisser un **commentaire rattaché** ("il a boité un peu au retour") qui apparaît dans le fil avec le contexte.

### 5. Profil de Wint & réglages
- Photo, nom, race, âge, notes libres (véto, particularités).
- Liste des membres du foyer, code d'invitation à partager (bouton copier + partage natif `navigator.share`).
- **Réglages du propriétaire** : définir les **créneaux de promenade** du foyer (nom + heures de début/fin, ajout/suppression), et l'**ordre de priorité des intervenants** pour la cascade de notifications (glisser-déposer), ainsi que le délai avant escalade.
- **Réglages personnels de chaque membre** : personnaliser ses rappels — activer/désactiver chaque type de notification, délai d'anticipation ("préviens-moi 30 min avant mon créneau"), heures de silence.
- **Intégration calendrier** : chaque membre dispose d'un **flux iCal personnel** (URL secrète) contenant ses gardes et ses promenades assignées, à ajouter par abonnement dans **Google Calendar** (ou Apple/Outlook) — les événements se mettent à jour automatiquement quand le planning change. Fournis un bouton "Ajouter à Google Calendar" avec les instructions, plus un lien "ajouter cet événement" ponctuel depuis n'importe quelle garde ou promenade. Le flux est servi par une Edge Function Supabase authentifiée par le jeton secret du membre.

### Notifications push (essentielles)
1. **Rappel avant créneau** : notification au promeneur assigné avant le début de son créneau, avec un délai d'anticipation personnalisable par membre (ex. 30 min avant).
2. **Rappel de créneau manqué** : si la promenade n'est pas validée à la fin du créneau (heures définies par le foyer), notifier le promeneur assigné ; si toujours rien 45 min plus tard, notifier tout le foyer.
3. **Rappel de garde** : la veille du début d'une période de garde, "C'est toi qui gardes Wint à partir de demain 18h".
4. **Remplacement en cascade** : la demande notifie les intervenants **un par un dans l'ordre de priorité** défini par le propriétaire (voir écran 3) — jamais tout le monde d'un coup, sauf si la liste est épuisée. Demande acceptée → le demandeur.
5. **Discussion** : nouveau message (désactivable).
Chaque membre contrôle ses notifications via ses préférences personnelles (types actifs, anticipation, heures de silence). Gère proprement la demande de permission (au bon moment, pas à l'ouverture), et le fallback si les push ne sont pas disponibles (badge dans l'app).

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
