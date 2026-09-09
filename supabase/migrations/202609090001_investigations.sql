create table if not exists public.investigations (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 255),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  engine text not null check (engine in ('local', 'backend')),
  node_count integer not null default 0 check (node_count >= 0),
  edge_count integer not null default 0 check (edge_count >= 0),
  dataset jsonb not null
);
alter table public.investigations enable row level security;
create policy "Users read own investigations" on public.investigations for select using (auth.uid() = user_id);
create policy "Users create own investigations" on public.investigations for insert with check (auth.uid() = user_id);
create policy "Users update own investigations" on public.investigations for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "Users delete own investigations" on public.investigations for delete using (auth.uid() = user_id);
create index if not exists investigations_user_created_idx on public.investigations(user_id, created_at desc);

create table if not exists public.audit_events (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  investigation_id uuid references public.investigations(id) on delete set null,
  action text not null,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
alter table public.audit_events enable row level security;
alter table public.audit_events drop constraint if exists audit_events_investigation_id_fkey;
alter table public.audit_events add constraint audit_events_investigation_id_fkey
  foreign key (investigation_id) references public.investigations(id) on delete set null;
create policy "Users read own audit events" on public.audit_events for select using (auth.uid() = user_id);
create policy "Users create own audit events" on public.audit_events for insert with check (auth.uid() = user_id);
create index if not exists audit_events_user_created_idx on public.audit_events(user_id, created_at desc);

create table if not exists public.investigation_shares (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  investigation_id uuid not null references public.investigations(id) on delete cascade,
  snapshot jsonb not null,
  expires_at timestamptz not null default (now() + interval '7 days'),
  revoked boolean not null default false,
  created_at timestamptz not null default now()
);
alter table public.investigation_shares enable row level security;
create policy "Owners manage investigation shares" on public.investigation_shares for all using (auth.uid() = owner_id) with check (auth.uid() = owner_id);
create or replace function public.get_shared_investigation(share_id uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select snapshot from public.investigation_shares
  where id = share_id and not revoked and expires_at > now()
  limit 1
$$;
revoke all on function public.get_shared_investigation(uuid) from public;
grant execute on function public.get_shared_investigation(uuid) to anon, authenticated;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  avatar_url text,
  role text not null default 'investigator' check (role in ('investigator', 'reviewer', 'admin')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.profiles enable row level security;
create policy "Users read own profile" on public.profiles for select using (auth.uid() = id);
create policy "Users update own profile" on public.profiles for update using (auth.uid() = id) with check (auth.uid() = id);
revoke update on public.profiles from authenticated;
grant update(display_name, avatar_url, updated_at) on public.profiles to authenticated;

create or replace function public.create_profile_for_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, display_name, avatar_url)
  values (new.id, new.raw_user_meta_data->>'full_name', coalesce(new.raw_user_meta_data->>'avatar_url', new.raw_user_meta_data->>'picture'))
  on conflict (id) do nothing;
  return new;
end;
$$;
drop trigger if exists create_profile_after_signup on auth.users;
create trigger create_profile_after_signup after insert on auth.users
for each row execute procedure public.create_profile_for_new_user();

insert into public.profiles (id, display_name, avatar_url)
select id, raw_user_meta_data->>'full_name', coalesce(raw_user_meta_data->>'avatar_url', raw_user_meta_data->>'picture')
from auth.users on conflict (id) do nothing;
