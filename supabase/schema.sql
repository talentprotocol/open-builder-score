-- Run once in the Supabase SQL editor (project faejimtdyfbawvdnvaly).

-- records and extra_emails hold a one-time export; the Rails export
-- normalizes (lowercases) emails before this load, so the constraints and
-- lookups below can assume that and stay case-sensitive.
create table records (
  id bigint generated always as identity primary key,
  profile_url text, name text, email text, location text,
  main_role text, reachable_via text, linkedin_url text,
  github_url text, github_username text, primary_languages text,
  expertise_level text, builder_score numeric,
  builder_score_updated_at timestamptz, verification text,
  human_verified boolean, data_as_of timestamptz
);
create index records_email_lower_idx on records (lower(email));

create table extra_emails (
  email text not null,
  record_id bigint not null references records (id) on delete cascade
);
create index extra_emails_email_lower_idx on extra_emails (lower(email));

create table opt_outs (
  id bigint generated always as identity primary key,
  email text not null unique,
  token_digest text not null unique,
  expires_at timestamptz not null,
  confirmed_at timestamptz,
  last_sent_at timestamptz,
  created_at timestamptz not null default now()
);

-- The lookup queries with case-sensitive equality against already-lowercased input,
-- so stored emails must be lowercase. Enforce it: a non-normalized load fails loudly
-- instead of silently failing to match real users.
alter table records
  add constraint records_email_lowercase_chk
  check (email is null or email = lower(email));

alter table extra_emails
  add constraint extra_emails_email_lowercase_chk
  check (email = lower(email));

-- The lower(email) expression indexes cannot serve a plain `eq.` filter. These match
-- the actual query shape; the expression indexes remain for ad-hoc case-insensitive SQL.
create index records_email_idx on records (email);
create index extra_emails_email_idx on extra_emails (email);

alter table records enable row level security;
alter table extra_emails enable row level security;
alter table opt_outs enable row level security;
-- No policies: deny-all for anon/authenticated; only the service key passes.
