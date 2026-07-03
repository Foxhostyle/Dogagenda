# Configurer Supabase pour Dogagenda 🐕

Ce guide met en place le backend complet : base Postgres (avec RLS), Realtime,
Storage, notifications push et flux calendrier. Comptez une vingtaine de
minutes. Sans cette configuration, l’application fonctionne en **mode démo**
(données locales à l’appareil) — parfait pour essayer, insuffisant pour la
famille.

## Prérequis

- Un compte sur [supabase.com](https://supabase.com) (le palier gratuit suffit).
- La CLI Supabase : `npm i -g supabase` (ou `npx supabase …`).
- Node.js (pour générer les clés VAPID).

## 1. Créer le projet Supabase

1. Sur [supabase.com/dashboard](https://supabase.com/dashboard), **New project**.
2. Choisissez un nom (ex. `dogagenda`), un mot de passe de base de données
   solide et une région proche (ex. **West EU (Paris)**).
3. Une fois le projet créé, notez dans **Settings → API** :
   - la **Project URL** (ex. `https://abcdefgh.supabase.co`) ;
   - la clé **anon public** ;
   - la clé **service_role** (secrète — ne la mettez jamais dans le frontend).
   Le **Project ref** est la partie `abcdefgh` de l’URL.

## 2. Appliquer la migration SQL

Deux possibilités :

**Via le SQL Editor (le plus simple)** : ouvrez **SQL Editor → New query**,
collez l’intégralité de `supabase/migrations/0001_init.sql`, puis **Run**.

**Via la CLI** :

```bash
supabase login
supabase link --project-ref <PROJECT_REF>
supabase db push
```

La migration crée les tables, les politiques RLS (chaque foyer ne voit que ses
données), les fonctions RPC (création de foyer, cascade de remplacement…), la
publication Realtime et le bucket de photos.

## 3. Activer les connexions anonymes

Dogagenda n’utilise ni email ni mot de passe : chaque appareil obtient un
compte anonyme persistant.

1. Dashboard → **Authentication → Sign In / Up** (ou *Providers* selon la
   version de l’interface).
2. Activez **Allow anonymous sign-ins**, puis enregistrez.

> Sans cette option, la création de foyer échouera avec une erreur
> d’authentification.

## 4. Générer les clés VAPID (notifications push)

```bash
npx web-push generate-vapid-keys
```

Notez la **Public Key** et la **Private Key**, puis enregistrez-les comme
secrets des Edge Functions :

```bash
supabase secrets set \
  VAPID_PUBLIC_KEY="<clé publique>" \
  VAPID_PRIVATE_KEY="<clé privée>" \
  VAPID_SUBJECT="mailto:vous@exemple.fr"
```

Optionnel : si votre famille ne vit pas à l’heure de Paris, définissez aussi
le fuseau utilisé par les rappels et le calendrier :

```bash
supabase secrets set APP_TZ="Europe/Paris"
```

## 5. Déployer les Edge Functions

```bash
supabase functions deploy reminders
supabase functions deploy ics --no-verify-jwt
```

- `reminders` : envoie les notifications push (rappels de créneau, créneaux
  manqués, rappels de garde, escalade des remplacements). Elle reste protégée
  par JWT : seul l’appel planifié avec la clé `service_role` (étape 6) peut la
  déclencher.
- `ics` : sert le flux iCal personnel de chaque membre. Le
  `--no-verify-jwt` est **indispensable** : Google Calendar appelle l’URL sans
  en-tête d’autorisation — la sécurité repose sur le jeton secret de chaque
  membre, présent dans l’URL.

## 6. Planifier `reminders` toutes les 5 minutes (pg_cron + pg_net)

Dans **Database → Extensions**, activez **pg_cron** et **pg_net** (ou exécutez
les deux premières lignes ci-dessous). Puis, dans le **SQL Editor**, exécutez
en remplaçant `<PROJECT_REF>` et `<SERVICE_ROLE_KEY>` :

```sql
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'dogagenda-reminders',        -- nom de la tâche
  '*/5 * * * *',                -- toutes les 5 minutes
  $$
  select net.http_post(
    url     := 'https://<PROJECT_REF>.supabase.co/functions/v1/reminders',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer <SERVICE_ROLE_KEY>'
    ),
    body    := '{}'::jsonb
  );
  $$
);
```

Pour vérifier que la tâche tourne :

```sql
select jobid, jobname, schedule, active from cron.job;
select status, return_message, start_time
from cron.job_run_details
order by start_time desc limit 10;
```

(Pour la supprimer un jour : `select cron.unschedule('dogagenda-reminders');`)

## 7. Configurer le frontend

À la racine du projet, copiez `.env.example` en `.env` et renseignez :

```bash
VITE_SUPABASE_URL=https://<PROJECT_REF>.supabase.co
VITE_SUPABASE_ANON_KEY=<clé anon public>
VITE_VAPID_PUBLIC_KEY=<clé publique VAPID (la même qu'à l'étape 4)>
```

En développement : `npm run dev`. Dès que ces variables sont présentes,
l’application quitte le mode démo et se synchronise via Supabase.

## 8. Déployer sur Vercel ou Netlify

**Vercel**

1. Importez le dépôt sur [vercel.com](https://vercel.com) — le `vercel.json`
   du projet est déjà prêt (build Vite + SPA).
2. Dans **Settings → Environment Variables**, ajoutez les trois variables
   `VITE_…` de l’étape 7.
3. Déployez. L’application doit être servie en **HTTPS** (c’est le cas par
   défaut) : les notifications push et l’installation PWA l’exigent.

**Netlify** : même principe — build `npm run build`, dossier de publication
`dist`, mêmes variables d’environnement, et une règle SPA
(`/* → /index.html 200`).

Invitez ensuite la famille : créez le foyer dans l’app, puis partagez le code
d’invitation à 6 caractères depuis l’onglet **Wint**.

## Vérifications ✅

- [ ] **Migration** : dans **Table Editor**, les tables `households`,
      `members`, `pets`, `slot_templates`, `care_periods`, `walk_slots`,
      `messages`, `swap_requests`, `notification_prefs`, `week_templates` et
      `reminder_log` existent, toutes avec RLS activée.
- [ ] **Auth anonyme** : créer un foyer depuis l’app fonctionne, et une ligne
      apparaît dans **Authentication → Users** (utilisateur anonyme).
- [ ] **RLS** : un deuxième foyer créé en navigation privée ne voit rien du
      premier.
- [ ] **Realtime** : deux navigateurs ouverts sur le même foyer — valider une
      promenade sur l’un l’affiche sur l’autre en moins de 2 secondes.
- [ ] **Storage** : joindre une photo à une validation l’affiche bien (bucket
      `photos`, fichier visible dans **Storage**).
- [ ] **Push** : activez les notifications dans les réglages de l’app, assignez-
      vous un créneau qui commence dans moins de 30 minutes, attendez le
      prochain passage du cron (≤ 5 min) : la notification arrive.
- [ ] **Cron** : `select * from cron.job_run_details order by start_time desc
      limit 5;` montre des exécutions `succeeded`.
- [ ] **Flux iCal** : l’URL « Abonnement calendrier » de l’onglet Wint
      (`…/functions/v1/ics?token=…`) télécharge un fichier `.ics` contenant
      vos gardes et promenades ; un jeton invalide renvoie bien un 404.
- [ ] **Remplacements** : « Je ne peux pas » sur un créneau notifie la première
      personne de la liste de priorité ; sans réponse sous 30 minutes, la
      demande passe à la personne suivante.

Bonnes promenades ! 🐾
