-- Run once in the Supabase SQL editor (project faejimtdyfbawvdnvaly).
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

alter table records enable row level security;
alter table extra_emails enable row level security;
alter table opt_outs enable row level security;
-- No policies: deny-all for anon/authenticated; only the service key passes.
