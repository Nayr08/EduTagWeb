create table if not exists public.system_settings (
  key text primary key,
  value text not null,
  updated_at timestamp with time zone default now()
);

insert into public.system_settings (key, value)
values ('student_maintenance', 'false')
on conflict (key) do nothing;

insert into public.system_settings (key, value)
values ('force_logout_version', '1')
on conflict (key) do nothing;
