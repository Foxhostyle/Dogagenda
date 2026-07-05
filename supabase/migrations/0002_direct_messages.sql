-- ============================================================================
-- Dogagenda — migration 0002 : messages privés entre membres
--
-- À exécuter sur un projet déjà initialisé avec 0001 (SQL Editor → Run).
-- Ajoute le destinataire optionnel des messages et restreint la lecture :
-- un message privé n'est visible que par son auteur et son destinataire.
-- ============================================================================

alter table public.messages
  add column if not exists recipient_id uuid references public.members (id) on delete cascade;

-- Identifiant du membre correspondant à l'utilisateur connecté dans le foyer.
create or replace function public.my_member_id(hid uuid)
returns uuid
language sql security definer stable set search_path = public
as $$
  select id from members where household_id = hid and user_id = auth.uid() limit 1;
$$;

drop policy if exists messages_select on public.messages;
create policy messages_select on public.messages
  for select using (
    is_household_member(household_id)
    and (
      recipient_id is null
      or recipient_id = my_member_id(household_id)
      or author_id = my_member_id(household_id)
    )
  );
