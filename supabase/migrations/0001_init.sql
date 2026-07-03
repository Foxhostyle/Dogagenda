-- ============================================================================
-- Dogagenda — migration initiale
--
-- Schéma complet du backend Supabase : tables, RLS, fonctions RPC,
-- Realtime et Storage. Le contrat côté frontend est
-- src/data/supabaseProvider.ts : chaque table, colonne et RPC référencée
-- ici doit exister exactement sous ce nom.
--
-- NB : la colonne « cascade » de swap_requests est un mot réservé SQL,
-- elle est donc TOUJOURS écrite "cascade" (entre guillemets doubles).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Tables
-- ----------------------------------------------------------------------------

create table public.households (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  invite_code text unique not null,
  -- Minutes sans réponse avant de faire avancer la cascade de remplacement.
  swap_escalate_minutes int not null default 30,
  created_at  timestamptz not null default now()
);

create table public.members (
  id                uuid primary key default gen_random_uuid(),
  household_id      uuid not null references public.households (id) on delete cascade,
  -- Compte auth (anonyme) du membre ; conservé à null si le compte disparaît.
  user_id           uuid references auth.users (id) on delete set null,
  name              text not null,
  emoji             text not null default '🦊',
  color             text not null default '#578764',
  role              text not null default 'member' check (role in ('owner', 'member', 'guest')),
  -- Ordre dans la cascade de notifications (0 = notifié en premier).
  priority_rank     int not null default 0,
  -- Abonnement Web Push (PushSubscriptionJSON), null si non activé.
  push_subscription jsonb,
  -- Jeton secret du flux iCal personnel.
  calendar_token    uuid not null default gen_random_uuid(),
  created_at        timestamptz default now()
);

create table public.pets (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  name         text not null,
  photo        text,
  breed        text,
  birth_date   date,
  notes        text
);

create table public.slot_templates (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  name         text not null,
  emoji        text not null default '🐾',
  start_time   time not null,
  end_time     time not null,
  sort_order   int not null default 0,
  active       boolean not null default true
);

-- Nécessaire à la contrainte d'exclusion anti-chevauchement des gardes.
create extension if not exists btree_gist;

create table public.care_periods (
  id        uuid primary key default gen_random_uuid(),
  pet_id    uuid not null references public.pets (id) on delete cascade,
  member_id uuid not null references public.members (id) on delete cascade,
  start_at  timestamptz not null,
  end_at    timestamptz not null,
  check (start_at < end_at),
  -- Deux appareils simultanés ne peuvent pas créer deux gardes qui se
  -- chevauchent : garanti au niveau base, pas seulement côté client.
  constraint care_periods_no_overlap
    exclude using gist (pet_id with =, tstzrange(start_at, end_at) with &&)
);

create table public.walk_slots (
  id                 uuid primary key default gen_random_uuid(),
  pet_id             uuid not null references public.pets (id) on delete cascade,
  date               date not null,
  slot_template_id   uuid not null references public.slot_templates (id) on delete cascade,
  assigned_member_id uuid references public.members (id) on delete set null,
  status             text not null default 'pending' check (status in ('pending', 'done', 'skipped')),
  -- Membre qui a réellement validé (uuid libre : l'historique survit aux départs).
  validated_by       uuid,
  validated_at       timestamptz,
  note               text,
  photo              text,
  unique (pet_id, date, slot_template_id)
);

create table public.messages (
  id                   uuid primary key default gen_random_uuid(),
  household_id         uuid not null references public.households (id) on delete cascade,
  -- Null pour les messages système, ou si l'auteur a quitté le foyer.
  author_id            uuid references public.members (id) on delete set null,
  kind                 text not null default 'user' check (kind in ('user', 'system')),
  text                 text not null default '',
  photo                text,
  -- Contexte optionnel : jour et/ou promenade commentée (uuid libre,
  -- le message survit à la suppression du créneau).
  ref_date             date,
  ref_slot_template_id uuid,
  created_at           timestamptz not null default now()
);

create table public.swap_requests (
  id                    uuid primary key default gen_random_uuid(),
  household_id          uuid not null references public.households (id) on delete cascade,
  -- Cible : soit une promenade (date + créneau), soit une période de garde.
  walk_slot_date        date,
  walk_slot_template_id uuid,
  care_period_id        uuid references public.care_periods (id) on delete cascade,
  requester_id          uuid not null references public.members (id) on delete cascade,
  message               text,
  status                text not null default 'open' check (status in ('open', 'accepted', 'cancelled', 'exhausted')),
  accepted_by           uuid,
  -- Historique de la cascade : tableau JSON d'objets camelCase
  -- {"memberId", "notifiedAt", "response", "respondedAt"} lus tels quels
  -- par le frontend. « cascade » est un mot réservé → toujours "cascade".
  "cascade"             jsonb not null default '[]'::jsonb,
  created_at            timestamptz not null default now(),
  resolved_at           timestamptz
);

create table public.notification_prefs (
  member_id     uuid primary key references public.members (id) on delete cascade,
  walk_reminder boolean not null default true,
  missed_walk   boolean not null default true,
  care_reminder boolean not null default true,
  swaps         boolean not null default true,
  chat          boolean not null default true,
  lead_minutes  int not null default 30,
  quiet_start   time,
  quiet_end     time
);

create table public.week_templates (
  household_id uuid primary key references public.households (id) on delete cascade,
  -- Clé "${weekday}-${slotTemplateId}" (weekday 0 = lundi) → memberId.
  assignments  jsonb not null default '{}'::jsonb
);

-- Déduplication des notifications envoyées par l'Edge Function reminders.
-- Accédée uniquement avec la clé service_role (aucune politique RLS).
create table public.reminder_log (
  key     text primary key,
  sent_at timestamptz default now()
);

-- Index utiles aux requêtes du frontend et des Edge Functions.
create index members_household_idx on public.members (household_id);
create index members_user_idx on public.members (user_id);
create index pets_household_idx on public.pets (household_id);
create index slot_templates_household_idx on public.slot_templates (household_id);
create index care_periods_pet_idx on public.care_periods (pet_id);
create index care_periods_start_idx on public.care_periods (start_at);
create index walk_slots_date_idx on public.walk_slots (date);
create index messages_household_created_idx on public.messages (household_id, created_at);
create index swap_requests_household_idx on public.swap_requests (household_id, status);

-- ----------------------------------------------------------------------------
-- Aides RLS (security definer : elles court-circuitent la RLS des tables
-- qu'elles consultent, ce qui évite toute récursion de politiques)
-- ----------------------------------------------------------------------------

-- Vrai si l'utilisateur connecté est membre du foyer `hid`.
create or replace function public.is_household_member(hid uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from members
    where household_id = hid and user_id = auth.uid()
  );
$$;

-- Vrai si l'utilisateur connecté est propriétaire du foyer `hid`.
create or replace function public.is_household_owner(hid uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from members
    where household_id = hid and user_id = auth.uid() and role = 'owner'
  );
$$;

-- Vrai si la ligne membre `p_member_id` appartient à l'utilisateur connecté.
create or replace function public.is_self(p_member_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from members
    where id = p_member_id and user_id = auth.uid()
  );
$$;

-- Foyer d'un animal (pour les tables liées par pet_id).
create or replace function public.pet_household(p_pet_id uuid)
returns uuid
language sql stable security definer set search_path = public
as $$
  select household_id from pets where id = p_pet_id;
$$;

-- Foyer d'un membre (pour notification_prefs).
create or replace function public.member_household(p_member_id uuid)
returns uuid
language sql stable security definer set search_path = public
as $$
  select household_id from members where id = p_member_id;
$$;

-- ----------------------------------------------------------------------------
-- RLS : confiance familiale à l'intérieur du foyer, rien entre foyers
-- ----------------------------------------------------------------------------

alter table public.households enable row level security;
alter table public.members enable row level security;
alter table public.pets enable row level security;
alter table public.slot_templates enable row level security;
alter table public.care_periods enable row level security;
alter table public.walk_slots enable row level security;
alter table public.messages enable row level security;
alter table public.swap_requests enable row level security;
alter table public.notification_prefs enable row level security;
alter table public.week_templates enable row level security;
alter table public.reminder_log enable row level security;

-- households : lecture seule ; création via le RPC create_household.
create policy households_select on public.households
  for select using (is_household_member(id));

-- members : lecture du foyer ; mise à jour de sa propre ligne ou par le
-- propriétaire ; insertion/suppression uniquement via les RPC.
create policy members_select on public.members
  for select using (is_household_member(household_id));
create policy members_update on public.members
  for update using (
    is_household_member(household_id)
    and (user_id = auth.uid() or is_household_owner(household_id))
  )
  with check (
    is_household_member(household_id)
    and (user_id = auth.uid() or is_household_owner(household_id))
  );

-- pets : CRUD complet pour les membres du foyer.
create policy pets_select on public.pets
  for select using (is_household_member(household_id));
create policy pets_insert on public.pets
  for insert with check (is_household_member(household_id));
create policy pets_update on public.pets
  for update using (is_household_member(household_id))
  with check (is_household_member(household_id));
create policy pets_delete on public.pets
  for delete using (is_household_member(household_id));

-- slot_templates : CRUD complet pour les membres du foyer.
create policy slot_templates_select on public.slot_templates
  for select using (is_household_member(household_id));
create policy slot_templates_insert on public.slot_templates
  for insert with check (is_household_member(household_id));
create policy slot_templates_update on public.slot_templates
  for update using (is_household_member(household_id))
  with check (is_household_member(household_id));
create policy slot_templates_delete on public.slot_templates
  for delete using (is_household_member(household_id));

-- care_periods : CRUD via le foyer de l'animal.
create policy care_periods_select on public.care_periods
  for select using (is_household_member(pet_household(pet_id)));
create policy care_periods_insert on public.care_periods
  for insert with check (is_household_member(pet_household(pet_id)));
create policy care_periods_update on public.care_periods
  for update using (is_household_member(pet_household(pet_id)))
  with check (is_household_member(pet_household(pet_id)));
create policy care_periods_delete on public.care_periods
  for delete using (is_household_member(pet_household(pet_id)));

-- walk_slots : CRUD via le foyer de l'animal.
create policy walk_slots_select on public.walk_slots
  for select using (is_household_member(pet_household(pet_id)));
create policy walk_slots_insert on public.walk_slots
  for insert with check (is_household_member(pet_household(pet_id)));
create policy walk_slots_update on public.walk_slots
  for update using (is_household_member(pet_household(pet_id)))
  with check (is_household_member(pet_household(pet_id)));
create policy walk_slots_delete on public.walk_slots
  for delete using (is_household_member(pet_household(pet_id)));

-- messages : lecture et écriture pour les membres du foyer (les messages
-- système de validation sont insérés directement par le client).
create policy messages_select on public.messages
  for select using (is_household_member(household_id));
create policy messages_insert on public.messages
  for insert with check (is_household_member(household_id));
create policy messages_update on public.messages
  for update using (is_household_member(household_id))
  with check (is_household_member(household_id));
create policy messages_delete on public.messages
  for delete using (is_household_member(household_id));

-- swap_requests : lecture + annulation directe côté client ; création et
-- réponse via les RPC (mais on reste permissif à l'échelle du foyer).
create policy swap_requests_select on public.swap_requests
  for select using (is_household_member(household_id));
create policy swap_requests_insert on public.swap_requests
  for insert with check (is_household_member(household_id));
create policy swap_requests_update on public.swap_requests
  for update using (is_household_member(household_id))
  with check (is_household_member(household_id));
create policy swap_requests_delete on public.swap_requests
  for delete using (is_household_member(household_id));

-- notification_prefs : lecture par le foyer, écriture de sa propre ligne.
create policy notification_prefs_select on public.notification_prefs
  for select using (is_household_member(member_household(member_id)));
create policy notification_prefs_insert on public.notification_prefs
  for insert with check (is_self(member_id));
create policy notification_prefs_update on public.notification_prefs
  for update using (is_self(member_id))
  with check (is_self(member_id));
create policy notification_prefs_delete on public.notification_prefs
  for delete using (is_self(member_id));

-- week_templates : CRUD complet pour les membres du foyer.
create policy week_templates_select on public.week_templates
  for select using (is_household_member(household_id));
create policy week_templates_insert on public.week_templates
  for insert with check (is_household_member(household_id));
create policy week_templates_update on public.week_templates
  for update using (is_household_member(household_id))
  with check (is_household_member(household_id));
create policy week_templates_delete on public.week_templates
  for delete using (is_household_member(household_id));

-- reminder_log : aucune politique — seule la clé service_role
-- (qui contourne la RLS) y accède.

-- ----------------------------------------------------------------------------
-- Aides internes aux RPC
-- ----------------------------------------------------------------------------

-- Instant courant au format ISO 8601 UTC, identique à `new Date().toISOString()`
-- côté JavaScript — le frontend lit ces valeurs telles quelles.
create or replace function public.iso_now()
returns text
language sql stable set search_path = public
as $$
  select to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
$$;

-- Libellé humain de la cible d'une demande de remplacement, pour les
-- messages système ("la promenade du 12/07", "la garde du 12/07 au 14/07").
create or replace function public.swap_label(p_walk_date date, p_care_period_id uuid)
returns text
language plpgsql stable security definer set search_path = public
as $$
declare
  v_period care_periods%rowtype;
begin
  if p_walk_date is not null then
    return 'la promenade du ' || to_char(p_walk_date, 'DD/MM');
  end if;
  if p_care_period_id is not null then
    select * into v_period from care_periods where id = p_care_period_id;
    if found then
      return 'la garde du ' || to_char(v_period.start_at at time zone 'Europe/Paris', 'DD/MM')
        || ' au ' || to_char(v_period.end_at at time zone 'Europe/Paris', 'DD/MM');
    end if;
  end if;
  return 'sa garde';
end;
$$;

-- ----------------------------------------------------------------------------
-- RPC : création / adhésion de foyer
-- ----------------------------------------------------------------------------

-- Crée le foyer, son propriétaire, l'animal, les trois créneaux par défaut
-- et les préférences de notification — le tout atomiquement.
create or replace function public.create_household(
  p_member_name text,
  p_member_emoji text,
  p_member_color text,
  p_pet_name text,
  p_pet_breed text,
  p_pet_birth_date date,
  p_pet_photo text
)
returns json
language plpgsql security definer set search_path = public
as $$
declare
  v_alphabet  constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  v_code      text;
  v_household uuid;
  v_member    uuid;
  i           int;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;

  -- Code d'invitation à 6 caractères, sans caractères ambigus (0/O, 1/I/L),
  -- retiré tant qu'il n'est pas unique.
  loop
    v_code := '';
    for i in 1..6 loop
      v_code := v_code || substr(v_alphabet, 1 + floor(random() * length(v_alphabet))::int, 1);
    end loop;
    exit when not exists (select 1 from households where invite_code = v_code);
  end loop;

  insert into households (name, invite_code)
  values ('La famille de ' || p_pet_name, v_code)
  returning id into v_household;

  insert into members (household_id, user_id, name, emoji, color, role, priority_rank)
  values (v_household, auth.uid(), p_member_name, p_member_emoji, p_member_color, 'owner', 0)
  returning id into v_member;

  insert into pets (household_id, name, breed, birth_date, photo)
  values (v_household, p_pet_name, p_pet_breed, p_pet_birth_date, p_pet_photo);

  -- Les trois créneaux par défaut, entièrement modifiables ensuite.
  insert into slot_templates (household_id, name, emoji, start_time, end_time, sort_order, active)
  values
    (v_household, 'Matin', '🌅', '07:00', '09:30', 0, true),
    (v_household, 'Après-midi', '☀️', '14:00', '17:00', 1, true),
    (v_household, 'Soir', '🌙', '19:00', '21:30', 2, true);

  insert into notification_prefs (member_id) values (v_member);

  return json_build_object('household_id', v_household, 'member_id', v_member);
end;
$$;

-- Rejoint un foyer existant via son code d'invitation.
create or replace function public.join_household(
  p_invite_code text,
  p_member_name text,
  p_member_emoji text,
  p_member_color text
)
returns json
language plpgsql security definer set search_path = public
as $$
declare
  v_household uuid;
  v_member    uuid;
  v_rank      int;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;

  select id into v_household from households where invite_code = p_invite_code;
  if v_household is null then
    raise exception 'invite_not_found';
  end if;

  -- Le nouveau venu passe en dernier dans la cascade de priorité.
  select count(*) into v_rank from members where household_id = v_household;

  insert into members (household_id, user_id, name, emoji, color, role, priority_rank)
  values (v_household, auth.uid(), p_member_name, p_member_emoji, p_member_color, 'member', v_rank)
  returning id into v_member;

  insert into notification_prefs (member_id) values (v_member);

  insert into messages (household_id, kind, text)
  values (v_household, 'system', p_member_name || ' a rejoint la famille 👋');

  return json_build_object('household_id', v_household, 'member_id', v_member);
end;
$$;

-- ----------------------------------------------------------------------------
-- RPC : cascade de remplacement
-- ----------------------------------------------------------------------------

-- Crée une demande de remplacement et notifie (dans les données) la première
-- personne de la liste de priorité — hors demandeur et invités.
create or replace function public.create_swap_request(
  p_walk_slot_date date,
  p_walk_slot_template_id uuid,
  p_care_period_id uuid,
  p_message text
)
returns json
language plpgsql security definer set search_path = public
as $$
declare
  v_me     members%rowtype;
  v_target uuid;
  v_id     uuid;
  v_now    text := iso_now();
begin
  select * into v_me from members
  where user_id = auth.uid()
  order by created_at desc limit 1;
  if not found then
    raise exception 'not_a_member';
  end if;

  -- Première cible de la cascade : le rang de priorité le plus bas,
  -- hors demandeur et hors invités.
  select id into v_target from members
  where household_id = v_me.household_id
    and id <> v_me.id
    and role <> 'guest'
  order by priority_rank, created_at
  limit 1;

  insert into swap_requests
    (household_id, walk_slot_date, walk_slot_template_id, care_period_id,
     requester_id, message, status, "cascade")
  values
    (v_me.household_id, p_walk_slot_date, p_walk_slot_template_id, p_care_period_id,
     v_me.id, p_message,
     case when v_target is null then 'exhausted' else 'open' end,
     case when v_target is null then '[]'::jsonb
          else jsonb_build_array(jsonb_build_object('memberId', v_target, 'notifiedAt', v_now))
     end)
  returning id into v_id;

  insert into messages (household_id, kind, text)
  values (v_me.household_id, 'system',
          v_me.name || ' cherche un remplaçant pour '
          || swap_label(p_walk_slot_date, p_care_period_id) || ' 🙏');

  return json_build_object('swap_id', v_id);
end;
$$;

-- Répond à une demande : acceptation (réassignation immédiate) ou refus
-- (la cascade avance vers la personne suivante, ou s'épuise).
create or replace function public.respond_swap(
  p_swap_id uuid,
  p_accept boolean
)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_swap    swap_requests%rowtype;
  v_me      members%rowtype;
  v_pet_id  uuid;
  v_cascade jsonb;
  v_last    jsonb;
  v_len     int;
  v_target  uuid;
  v_now     text := iso_now();
begin
  -- Verrouillage : deux réponses simultanées ne peuvent pas se marcher dessus.
  select * into v_swap from swap_requests where id = p_swap_id for update;
  if not found then
    raise exception 'swap_not_found';
  end if;

  select * into v_me from members
  where user_id = auth.uid() and household_id = v_swap.household_id
  limit 1;
  if not found then
    raise exception 'not_a_member';
  end if;

  -- Une demande acceptée ou annulée ne bouge plus (une demande épuisée
  -- reste acceptable par n'importe qui).
  if v_swap.status in ('accepted', 'cancelled') then
    return;
  end if;

  if p_accept then
    update swap_requests
    set status = 'accepted', accepted_by = v_me.id, resolved_at = now()
    where id = p_swap_id;

    if v_swap.walk_slot_date is not null and v_swap.walk_slot_template_id is not null then
      select id into v_pet_id from pets where household_id = v_swap.household_id limit 1;
      insert into walk_slots (pet_id, date, slot_template_id, assigned_member_id)
      values (v_pet_id, v_swap.walk_slot_date, v_swap.walk_slot_template_id, v_me.id)
      on conflict (pet_id, date, slot_template_id)
      do update set assigned_member_id = excluded.assigned_member_id;
    elsif v_swap.care_period_id is not null then
      update care_periods set member_id = v_me.id where id = v_swap.care_period_id;
    end if;

    insert into messages (household_id, kind, text)
    values (v_swap.household_id, 'system',
            v_me.name || ' remplace '
            || coalesce((select name from members where id = v_swap.requester_id), 'quelqu’un')
            || ' pour ' || swap_label(v_swap.walk_slot_date, v_swap.care_period_id) || ' 🙌');
    return;
  end if;

  -- Refus : uniquement si l'appelant EST la cible courante non répondue —
  -- sinon (double tap, bannière périmée après escalade) un membre serait
  -- silencieusement sauté dans la cascade.
  v_cascade := v_swap."cascade";
  v_len := jsonb_array_length(v_cascade);
  if v_len = 0 then
    return;
  end if;
  v_last := v_cascade -> (v_len - 1);
  if (v_last ? 'response') or (v_last ->> 'memberId')::uuid <> v_me.id then
    return;
  end if;
  v_cascade := jsonb_set(
    v_cascade,
    array[(v_len - 1)::text],
    v_last || jsonb_build_object('response', 'declined', 'respondedAt', v_now)
  );

  -- Personne suivante : par rang de priorité, hors demandeur, hors invités,
  -- hors membres déjà sollicités.
  select m.id into v_target from members m
  where m.household_id = v_swap.household_id
    and m.id <> v_swap.requester_id
    and m.role <> 'guest'
    and not exists (
      select 1 from jsonb_array_elements(v_cascade) step
      where (step ->> 'memberId')::uuid = m.id
    )
  order by m.priority_rank, m.created_at
  limit 1;

  if v_target is not null then
    update swap_requests
    set "cascade" = v_cascade
      || jsonb_build_array(jsonb_build_object('memberId', v_target, 'notifiedAt', v_now))
    where id = p_swap_id;
  else
    update swap_requests
    set "cascade" = v_cascade, status = 'exhausted'
    where id = p_swap_id;

    insert into messages (household_id, kind, text)
    values (v_swap.household_id, 'system',
            'Personne n’est disponible pour '
            || swap_label(v_swap.walk_slot_date, v_swap.care_period_id)
            || ' pour l’instant — quelqu’un peut aider ? 🆘');
  end if;
end;
$$;

-- ----------------------------------------------------------------------------
-- RPC : gestion des membres
-- ----------------------------------------------------------------------------

-- Réordonne la cascade de priorité : priority_rank = position dans le tableau.
-- N'agit que sur les membres du foyer de l'appelant.
create or replace function public.update_member_priorities(p_member_ids uuid[])
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_hh uuid;
  i    int;
begin
  select household_id into v_hh from members
  where user_id = auth.uid()
  order by created_at desc limit 1;
  if v_hh is null then
    raise exception 'not_a_member';
  end if;

  for i in 1..coalesce(array_length(p_member_ids, 1), 0) loop
    update members set priority_rank = i - 1
    where id = p_member_ids[i] and household_id = v_hh;
  end loop;
end;
$$;

-- Retire un membre du foyer (propriétaire uniquement, jamais un propriétaire) :
-- libère ses promenades à venir, fait avancer les cascades dont il était la
-- cible (comme demoProvider.removeMember), puis supprime la ligne.
create or replace function public.remove_member(p_member_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_me      members%rowtype;
  v_target  members%rowtype;
  v_swap    record;
  v_cascade jsonb;
  v_last    jsonb;
  v_len     int;
  v_next    uuid;
  v_now     text := iso_now();
begin
  select * into v_me from members
  where user_id = auth.uid()
  order by created_at desc limit 1;
  if not found or v_me.role <> 'owner' then
    raise exception 'owner_only';
  end if;

  select * into v_target from members
  where id = p_member_id and household_id = v_me.household_id;
  if not found then
    raise exception 'member_not_found';
  end if;
  if v_target.role = 'owner' then
    raise exception 'cannot_remove_owner';
  end if;

  -- Libère ses promenades à venir (les validations passées restent).
  update walk_slots ws
  set assigned_member_id = null
  from pets p
  where ws.pet_id = p.id
    and p.household_id = v_me.household_id
    and ws.assigned_member_id = p_member_id
    and ws.date >= current_date
    and ws.status = 'pending';

  -- Fait avancer les cascades ouvertes dont il était la cible courante.
  for v_swap in
    select * from swap_requests
    where household_id = v_me.household_id and status = 'open'
    for update
  loop
    v_cascade := v_swap."cascade";
    v_len := jsonb_array_length(v_cascade);
    if v_len = 0 then
      continue;
    end if;
    v_last := v_cascade -> (v_len - 1);
    if (v_last ? 'response') or (v_last ->> 'memberId')::uuid <> p_member_id then
      continue;
    end if;

    v_cascade := jsonb_set(
      v_cascade,
      array[(v_len - 1)::text],
      v_last || jsonb_build_object('response', 'declined', 'respondedAt', v_now)
    );

    select m.id into v_next from members m
    where m.household_id = v_me.household_id
      and m.id <> v_swap.requester_id
      and m.id <> p_member_id
      and m.role <> 'guest'
      and not exists (
        select 1 from jsonb_array_elements(v_cascade) step
        where (step ->> 'memberId')::uuid = m.id
      )
    order by m.priority_rank, m.created_at
    limit 1;

    if v_next is not null then
      update swap_requests
      set "cascade" = v_cascade
        || jsonb_build_array(jsonb_build_object('memberId', v_next, 'notifiedAt', v_now))
      where id = v_swap.id;
    else
      update swap_requests
      set "cascade" = v_cascade, status = 'exhausted'
      where id = v_swap.id;
    end if;
  end loop;

  -- Ses gardes disparaissent (fk cascade), ses messages restent (auteur → null).
  delete from members where id = p_member_id;
end;
$$;

-- ----------------------------------------------------------------------------
-- Realtime : diffusion des changements aux clients abonnés
-- ----------------------------------------------------------------------------

alter publication supabase_realtime add table
  public.members,
  public.pets,
  public.slot_templates,
  public.care_periods,
  public.walk_slots,
  public.messages,
  public.swap_requests,
  public.week_templates;

-- ----------------------------------------------------------------------------
-- Storage : bucket public « photos »
-- ----------------------------------------------------------------------------

insert into storage.buckets (id, name, public)
values ('photos', 'photos', true)
on conflict do nothing;

-- Lecture publique (les URL contiennent un uuid non devinable),
-- écriture réservée aux utilisateurs connectés.
create policy photos_public_read on storage.objects
  for select using (bucket_id = 'photos');
create policy photos_auth_insert on storage.objects
  for insert to authenticated with check (bucket_id = 'photos');
