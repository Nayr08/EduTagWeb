insert into public.system_settings (key, value, updated_at)
values ('force_logout_version', extract(epoch from now())::text, now())
on conflict (key) do update
set value = excluded.value,
    updated_at = excluded.updated_at;
