-- RodaKawan: foundational schema for an MVP.
-- Review and test in a development Supabase project before production use.
-- Sensitive vehicle details intentionally live in a separate owner-only table.

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null unique check (char_length(username) between 3 and 30),
  display_name text not null check (char_length(display_name) between 1 and 80),
  avatar_url text,
  bio text check (bio is null or char_length(bio) <= 300),
  city text check (city is null or char_length(city) <= 80),
  is_private boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.motorcycles (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  nickname text check (nickname is null or char_length(nickname) <= 60),
  make text not null check (char_length(make) <= 80),
  model text not null check (char_length(model) <= 100),
  model_year int check (model_year is null or model_year between 1950 and 2100),
  photo_path text,
  description text check (description is null or char_length(description) <= 500),
  is_public boolean not null default true,
  is_primary boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists motorcycles_owner_id_idx on public.motorcycles(owner_id);

create table if not exists public.motorcycle_private_details (
  motorcycle_id uuid primary key references public.motorcycles(id) on delete cascade,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  plate_number text,
  private_notes text,
  updated_at timestamptz not null default now()
);
create index if not exists motorcycle_private_details_owner_idx on public.motorcycle_private_details(owner_id);

create table if not exists public.clubs (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 100),
  slug text not null unique check (char_length(slug) between 3 and 80),
  description text check (description is null or char_length(description) <= 2000),
  logo_path text,
  visibility text not null default 'public' check (visibility in ('public','private')),
  join_policy text not null default 'approval' check (join_policy in ('open','approval','invite_only')),
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.club_members (
  club_id uuid not null references public.clubs(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null default 'member' check (role in ('owner','admin','member')),
  status text not null default 'pending' check (status in ('pending','active','rejected','removed','left')),
  joined_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (club_id, user_id)
);
create index if not exists club_members_user_idx on public.club_members(user_id, status);
create index if not exists club_members_club_idx on public.club_members(club_id, status);

create table if not exists public.rides (
  id uuid primary key default gen_random_uuid(),
  club_id uuid references public.clubs(id) on delete set null,
  created_by uuid not null references public.profiles(id) on delete restrict,
  title text not null check (char_length(title) between 3 and 120),
  description text check (description is null or char_length(description) <= 2000),
  activity_type text not null default 'motorcycle' check (activity_type in ('motorcycle','cycling','mixed','other')),
  status text not null default 'planned' check (status in ('planned','active','completed','cancelled')),
  visibility text not null default 'invite_only' check (visibility in ('club','invite_only','public')),
  starts_at timestamptz,
  meeting_label text,
  meeting_lat double precision check (meeting_lat is null or meeting_lat between -90 and 90),
  meeting_lng double precision check (meeting_lng is null or meeting_lng between -180 and 180),
  destination_label text,
  destination_lat double precision check (destination_lat is null or destination_lat between -90 and 90),
  destination_lng double precision check (destination_lng is null or destination_lng between -180 and 180),
  invite_code text unique,
  started_at timestamptz,
  ended_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((meeting_lat is null) = (meeting_lng is null)),
  check ((destination_lat is null) = (destination_lng is null)),
  check (ended_at is null or started_at is null or ended_at >= started_at)
);
create index if not exists rides_club_status_idx on public.rides(club_id, status, starts_at);
create index if not exists rides_creator_idx on public.rides(created_by, created_at desc);

create table if not exists public.ride_members (
  ride_id uuid not null references public.rides(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null default 'rider' check (role in ('host','sweeper','rider')),
  status text not null default 'joined' check (status in ('invited','joined','left','removed')),
  joined_at timestamptz,
  last_seen_at timestamptz,
  sharing_location boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (ride_id, user_id)
);
create index if not exists ride_members_user_idx on public.ride_members(user_id, status);
create index if not exists ride_members_ride_idx on public.ride_members(ride_id, status);

create table if not exists public.ride_locations (
  ride_id uuid not null references public.rides(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  latitude double precision not null check (latitude between -90 and 90),
  longitude double precision not null check (longitude between -180 and 180),
  accuracy_m double precision check (accuracy_m is null or accuracy_m >= 0),
  heading_deg double precision check (heading_deg is null or heading_deg >= 0 and heading_deg < 360),
  speed_mps double precision check (speed_mps is null or speed_mps >= 0),
  recorded_at timestamptz not null,
  updated_at timestamptz not null default now(),
  primary key (ride_id, user_id)
);
create index if not exists ride_locations_updated_at_idx on public.ride_locations(ride_id, updated_at desc);

create table if not exists public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  ride_id uuid not null references public.rides(id) on delete cascade,
  sender_id uuid not null references public.profiles(id) on delete restrict,
  message_type text not null default 'text' check (message_type in ('text','system')),
  content text not null check (char_length(content) between 1 and 2000),
  created_at timestamptz not null default now(),
  edited_at timestamptz,
  deleted_at timestamptz
);
create index if not exists chat_messages_ride_created_idx on public.chat_messages(ride_id, created_at desc);

create table if not exists public.hazard_reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references public.profiles(id) on delete restrict,
  ride_id uuid references public.rides(id) on delete set null,
  category text not null check (category in ('pothole','crash','traffic','weather','flood','road_block','traffic_enforcement','other')),
  description text check (description is null or char_length(description) <= 1000),
  severity text not null default 'moderate' check (severity in ('info','moderate','high','critical')),
  latitude double precision not null check (latitude between -90 and 90),
  longitude double precision not null check (longitude between -180 and 180),
  status text not null default 'active' check (status in ('active','expired','dismissed','removed','resolved')),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists hazard_reports_active_expiry_idx on public.hazard_reports(status, expires_at desc);
create index if not exists hazard_reports_reporter_idx on public.hazard_reports(reporter_id, created_at desc);

create table if not exists public.club_posts (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete cascade,
  author_id uuid not null references public.profiles(id) on delete restrict,
  content text check (content is null or char_length(content) <= 5000),
  media_path text,
  visibility text not null default 'club' check (visibility in ('club','public')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (content is not null or media_path is not null)
);
create index if not exists club_posts_feed_idx on public.club_posts(club_id, created_at desc);

create table if not exists public.post_comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.club_posts(id) on delete cascade,
  author_id uuid not null references public.profiles(id) on delete restrict,
  content text not null check (char_length(content) between 1 and 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists post_comments_post_idx on public.post_comments(post_id, created_at asc);

create table if not exists public.post_reactions (
  post_id uuid not null references public.club_posts(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  reaction text not null default 'like' check (reaction in ('like')),
  created_at timestamptz not null default now(),
  primary key (post_id, user_id, reaction)
);

create table if not exists public.follows (
  follower_id uuid not null references public.profiles(id) on delete cascade,
  followed_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (follower_id, followed_id),
  check (follower_id <> followed_id)
);
create index if not exists follows_followed_idx on public.follows(followed_id, created_at desc);


create table if not exists public.user_blocks (
  blocker_id uuid not null references public.profiles(id) on delete cascade,
  blocked_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);
create index if not exists user_blocks_blocked_idx on public.user_blocks(blocked_id);

create table if not exists public.content_reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references public.profiles(id) on delete restrict,
  target_type text not null check (target_type in ('user','club','post','comment','hazard','chat_message')),
  target_id uuid not null,
  reason text not null check (reason in ('spam','harassment','false_information','unsafe_content','privacy','other')),
  details text check (details is null or char_length(details) <= 2000),
  status text not null default 'open' check (status in ('open','reviewed','removed','dismissed')),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz
);
create index if not exists content_reports_status_created_idx on public.content_reports(status, created_at desc);

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  actor_id uuid references public.profiles(id) on delete set null,
  kind text not null check (kind in ('ride_invite','ride_started','ride_ended','club_join_request','club_join_approved','like','comment','follow','follow_back','system')),
  entity_type text,
  entity_id uuid,
  payload jsonb not null default '{}'::jsonb,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists notifications_recipient_created_idx on public.notifications(recipient_id, created_at desc);

create table if not exists public.push_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  token text not null unique,
  platform text not null check (platform in ('android','ios','other')),
  device_label text,
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index if not exists push_tokens_user_idx on public.push_tokens(user_id);

-- Helper functions are SECURITY DEFINER to avoid recursive membership RLS checks.
-- Keep these functions narrow, fixed-search-path, and covered by tests.
create or replace function public.is_club_member(p_club_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.club_members cm
    where cm.club_id = p_club_id
      and cm.user_id = auth.uid()
      and cm.status = 'active'
  );
$$;

create or replace function public.is_club_admin(p_club_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.club_members cm
    where cm.club_id = p_club_id
      and cm.user_id = auth.uid()
      and cm.status = 'active'
      and cm.role in ('owner','admin')
  );
$$;

create or replace function public.is_ride_member(p_ride_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.ride_members rm
    where rm.ride_id = p_ride_id
      and rm.user_id = auth.uid()
      and rm.status = 'joined'
  );
$$;

create or replace function public.is_ride_host(p_ride_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.ride_members rm
    where rm.ride_id = p_ride_id
      and rm.user_id = auth.uid()
      and rm.status = 'joined'
      and rm.role = 'host'
  );
$$;


create or replace function public.is_ride_active_member(p_ride_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.ride_members rm
    join public.rides r on r.id = rm.ride_id
    where rm.ride_id = p_ride_id
      and rm.user_id = auth.uid()
      and rm.status = 'joined'
      and r.status = 'active'
  );
$$;

create or replace function public.can_publish_ride_location(p_ride_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.ride_members rm
    join public.rides r on r.id = rm.ride_id
    where rm.ride_id = p_ride_id
      and rm.user_id = auth.uid()
      and rm.status = 'joined'
      and rm.sharing_location = true
      and r.status = 'active'
  );
$$;

-- Ensure function execution isn't granted more broadly than needed.
revoke all on function public.is_club_member(uuid) from public;
revoke all on function public.is_club_admin(uuid) from public;
revoke all on function public.is_ride_member(uuid) from public;
revoke all on function public.is_ride_host(uuid) from public;
revoke all on function public.is_ride_active_member(uuid) from public;
revoke all on function public.can_publish_ride_location(uuid) from public;
grant execute on function public.is_club_member(uuid) to authenticated;
grant execute on function public.is_club_admin(uuid) to authenticated;
grant execute on function public.is_ride_member(uuid) to authenticated;
grant execute on function public.is_ride_host(uuid) to authenticated;
grant execute on function public.is_ride_active_member(uuid) to authenticated;
grant execute on function public.can_publish_ride_location(uuid) to authenticated;

-- Enable RLS for all tables exposed through the Data API.
alter table public.profiles enable row level security;
alter table public.motorcycles enable row level security;
alter table public.motorcycle_private_details enable row level security;
alter table public.clubs enable row level security;
alter table public.club_members enable row level security;
alter table public.rides enable row level security;
alter table public.ride_members enable row level security;
alter table public.ride_locations enable row level security;
alter table public.chat_messages enable row level security;
alter table public.hazard_reports enable row level security;
alter table public.club_posts enable row level security;
alter table public.post_comments enable row level security;
alter table public.post_reactions enable row level security;
alter table public.follows enable row level security;
alter table public.user_blocks enable row level security;
alter table public.content_reports enable row level security;
alter table public.notifications enable row level security;
alter table public.push_tokens enable row level security;

-- Profiles: this table must contain only safe-to-show profile fields.
create policy "profiles_select_visible" on public.profiles
  for select to authenticated using (
    id = auth.uid()
    or is_private = false
    or exists (
      select 1 from public.follows f
      where f.follower_id = auth.uid() and f.followed_id = profiles.id
    )
  );
create policy "profiles_insert_self" on public.profiles
  for insert to authenticated with check (id = auth.uid());
create policy "profiles_update_self" on public.profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

-- Publicly visible motorcycle fields are separate from private details.
create policy "motorcycles_select_visible" on public.motorcycles
  for select to authenticated using (is_public = true or owner_id = auth.uid());
create policy "motorcycles_insert_owner" on public.motorcycles
  for insert to authenticated with check (owner_id = auth.uid());
create policy "motorcycles_update_owner" on public.motorcycles
  for update to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy "motorcycles_delete_owner" on public.motorcycles
  for delete to authenticated using (owner_id = auth.uid());

create policy "motorcycle_private_select_owner" on public.motorcycle_private_details
  for select to authenticated using (owner_id = auth.uid());
create policy "motorcycle_private_insert_owner" on public.motorcycle_private_details
  for insert to authenticated with check (
    owner_id = auth.uid() and exists (
      select 1 from public.motorcycles m where m.id = motorcycle_id and m.owner_id = auth.uid()
    )
  );
create policy "motorcycle_private_update_owner" on public.motorcycle_private_details
  for update to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy "motorcycle_private_delete_owner" on public.motorcycle_private_details
  for delete to authenticated using (owner_id = auth.uid());

create policy "clubs_select_public_or_member" on public.clubs
  for select to authenticated using (visibility = 'public' or public.is_club_member(id) or created_by = auth.uid());
-- Club creation goes through a server-side RPC/Edge Function that creates
-- the club and owner membership atomically; no direct client INSERT policy.
create policy "clubs_update_admin" on public.clubs
  for update to authenticated using (public.is_club_admin(id) or created_by = auth.uid())
  with check (public.is_club_admin(id) or created_by = auth.uid());
-- Membership mutations should be performed through a vetted RPC/Edge Function
-- that atomically enforces join_policy and owner/admin permissions. No direct
-- client INSERT/UPDATE/DELETE policy is intentionally defined here.
create policy "club_members_select_self_or_member" on public.club_members
  for select to authenticated using (user_id = auth.uid() or public.is_club_member(club_id) or public.is_club_admin(club_id));

create policy "rides_select_allowed" on public.rides
  for select to authenticated using (
    created_by = auth.uid()
    or public.is_ride_member(id)
    or (visibility = 'public')
    or (visibility = 'club' and club_id is not null and public.is_club_member(club_id))
  );
-- Ride creation and state transitions go through vetted RPC/Edge Functions
-- so a host membership is created atomically and the state machine is enforced.
-- No direct client INSERT/UPDATE/DELETE policy is defined for rides.
create policy "ride_members_select_self_or_member" on public.ride_members
  for select to authenticated using (user_id = auth.uid() or public.is_ride_member(ride_id) or public.is_ride_host(ride_id));
-- Membership insert/update/delete is intentionally routed through server RPC/Edge Functions.

create policy "ride_locations_select_active_member" on public.ride_locations
  for select to authenticated using (public.is_ride_active_member(ride_id));
create policy "ride_locations_insert_active_sharer" on public.ride_locations
  for insert to authenticated with check (user_id = auth.uid() and public.can_publish_ride_location(ride_id));
create policy "ride_locations_update_active_sharer" on public.ride_locations
  for update to authenticated using (user_id = auth.uid() and public.can_publish_ride_location(ride_id))
  with check (user_id = auth.uid() and public.can_publish_ride_location(ride_id));
create policy "ride_locations_delete_self" on public.ride_locations
  for delete to authenticated using (user_id = auth.uid());

create policy "chat_select_ride_member" on public.chat_messages
  for select to authenticated using (public.is_ride_member(ride_id));
create policy "chat_insert_self_member" on public.chat_messages
  for insert to authenticated with check (sender_id = auth.uid() and public.is_ride_member(ride_id));
create policy "chat_update_own_text" on public.chat_messages
  for update to authenticated using (sender_id = auth.uid() and message_type = 'text')
  with check (sender_id = auth.uid() and message_type = 'text' and public.is_ride_member(ride_id));
create policy "chat_delete_own" on public.chat_messages
  for delete to authenticated using (sender_id = auth.uid() and message_type = 'text');

create policy "hazards_select_current_or_reporter" on public.hazard_reports
  for select to authenticated using ((status = 'active' and expires_at > now()) or reporter_id = auth.uid());
create policy "hazards_insert_self" on public.hazard_reports
  for insert to authenticated with check (reporter_id = auth.uid());
-- Hazard expiry/status moderation is server-controlled; clients submit corrections
-- as a new report or call a vetted correction function.

create policy "club_posts_select_visible" on public.club_posts
  for select to authenticated using (
    public.is_club_member(club_id)
    or (visibility = 'public' and exists (select 1 from public.clubs c where c.id = club_id and c.visibility = 'public'))
  );
create policy "club_posts_insert_member" on public.club_posts
  for insert to authenticated with check (author_id = auth.uid() and public.is_club_member(club_id));
create policy "club_posts_update_author_or_admin" on public.club_posts
  for update to authenticated using (author_id = auth.uid() or public.is_club_admin(club_id))
  with check ((author_id = auth.uid() and public.is_club_member(club_id)) or public.is_club_admin(club_id));
create policy "club_posts_delete_author_or_admin" on public.club_posts
  for delete to authenticated using (author_id = auth.uid() or public.is_club_admin(club_id));

create policy "comments_select_visible_post" on public.post_comments
  for select to authenticated using (exists (select 1 from public.club_posts p where p.id = post_id));
create policy "comments_insert_self" on public.post_comments
  for insert to authenticated with check (author_id = auth.uid() and exists (select 1 from public.club_posts p where p.id = post_id));
create policy "comments_update_author" on public.post_comments
  for update to authenticated using (author_id = auth.uid()) with check (author_id = auth.uid());
create policy "comments_delete_author" on public.post_comments
  for delete to authenticated using (author_id = auth.uid());

create policy "reactions_select_visible_post" on public.post_reactions
  for select to authenticated using (exists (select 1 from public.club_posts p where p.id = post_id));
create policy "reactions_insert_self" on public.post_reactions
  for insert to authenticated with check (user_id = auth.uid() and exists (select 1 from public.club_posts p where p.id = post_id));
create policy "reactions_delete_self" on public.post_reactions
  for delete to authenticated using (user_id = auth.uid());

create policy "follows_select_related" on public.follows
  for select to authenticated using (follower_id = auth.uid() or followed_id = auth.uid());
create policy "follows_insert_self" on public.follows
  for insert to authenticated with check (follower_id = auth.uid());
create policy "follows_delete_self" on public.follows
  for delete to authenticated using (follower_id = auth.uid());


create policy "user_blocks_select_own" on public.user_blocks
  for select to authenticated using (blocker_id = auth.uid());
create policy "user_blocks_insert_own" on public.user_blocks
  for insert to authenticated with check (blocker_id = auth.uid());
create policy "user_blocks_delete_own" on public.user_blocks
  for delete to authenticated using (blocker_id = auth.uid());

create policy "content_reports_select_reporter" on public.content_reports
  for select to authenticated using (reporter_id = auth.uid());
create policy "content_reports_insert_self" on public.content_reports
  for insert to authenticated with check (reporter_id = auth.uid());
-- Review/status changes are performed by a trusted moderation backend.

create policy "notifications_select_recipient" on public.notifications
  for select to authenticated using (recipient_id = auth.uid());
create policy "notifications_update_recipient" on public.notifications
  for update to authenticated using (recipient_id = auth.uid()) with check (recipient_id = auth.uid());
-- Notification INSERT is backend-only; no client insert policy is defined.

create policy "push_tokens_select_self" on public.push_tokens
  for select to authenticated using (user_id = auth.uid());
create policy "push_tokens_insert_self" on public.push_tokens
  for insert to authenticated with check (user_id = auth.uid());
create policy "push_tokens_update_self" on public.push_tokens
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "push_tokens_delete_self" on public.push_tokens
  for delete to authenticated using (user_id = auth.uid());

-- IMPORTANT FOLLOW-UP WORK BEFORE PRODUCTION:
-- 1. Add a safe auth.users -> profiles bootstrap trigger or create profile through
--    a vetted server/RPC flow. Validate username uniqueness and metadata first.
-- 2. Implement and test transactional RPC/Edge Functions for creating clubs,
--    club memberships, creating rides, ride memberships, sharing-location toggles,
--    and ride state transitions.
-- 3. Configure private Supabase Realtime authorization for ride:<uuid>:* topics.
--    Table RLS alone is not proof that private Broadcast topics are protected.
-- 4. Add Storage bucket policies for club logos, post media and avatars.
-- 5. Add automated allow/deny RLS tests for every table and user role.
-- 6. Verify comment reads cannot reveal private club posts under actual policies.
-- 7. Ensure server queries filter blocked users/contents; RLS is only one layer.
-- 8. Restrict grants/schema exposure as recommended by current Supabase docs.
