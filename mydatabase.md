create table public.admin_info (
  idadmin_info serial not null,
  admin_username character varying(50) not null,
  password character varying(255) not null,
  auth_id uuid null,
  constraint admin_info_pkey primary key (idadmin_info),
  constraint admin_info_admin_username_key unique (admin_username),
  constraint admin_info_auth_id_fkey foreign KEY (auth_id) references auth.users (id)
) TABLESPACE pg_default;


create table public.attendance (
  idattendance serial not null,
  student_id integer not null,
  event_id integer not null,
  scan_time time without time zone null default CURRENT_TIMESTAMP,
  status character varying(10) null default 'present'::character varying,
  date date null,
  student_name_cached text null,
  student_school_id_cached text null,
  constraint attendance_pkey primary key (idattendance),
  constraint unique_student_event unique (student_id, event_id),
  constraint attendance_event_id_fkey foreign KEY (event_id) references event_info (idevent_info),
  constraint attendance_student_id_fkey foreign KEY (student_id) references student_info (idstudent_info),
  constraint attendance_status_check check (
    (
      (status)::text = any (
        (
          array[
            'present'::character varying,
            'absent'::character varying,
            'late'::character varying,
            'excused'::character varying
          ]
        )::text[]
      )
    )
  )
) TABLESPACE pg_default;

create index IF not exists idx_attendance_student_name_cached_lower on public.attendance using btree (lower(student_name_cached)) TABLESPACE pg_default;

create index IF not exists idx_attendance_student_school_id_cached_lower on public.attendance using btree (lower(student_school_id_cached)) TABLESPACE pg_default;

create table public.event_deletion_logs (
  id serial not null,
  admin_id uuid null,
  admin_username text null,
  event_id integer null,
  event_name text null,
  deletion_time timestamp without time zone null default (now() AT TIME ZONE 'Asia/Manila'::text),
  status text null,
  ip_address text null,
  constraint event_deletion_logs_pkey primary key (id),
  constraint event_deletion_logs_admin_id_fkey foreign KEY (admin_id) references auth.users (id)
) TABLESPACE pg_default;



create table public.event_info (
  idevent_info serial not null,
  event_name character varying(100) not null,
  date date not null,
  time_start time without time zone not null,
  time_end time without time zone not null,
  status character varying(15) null default 'upcoming'::character varying,
  closed boolean not null default false,
  late_until time without time zone not null,
  constraint event_info_pkey primary key (idevent_info),
  constraint event_info_status_check check (
    (
      (status)::text = any (
        (
          array[
            'upcoming'::character varying,
            'ongoing'::character varying,
            'completed'::character varying
          ]
        )::text[]
      )
    )
  )
) TABLESPACE pg_default;

create table public.sanction_access_logs (
  id serial not null,
  admin_id uuid null,
  admin_username text null,
  access_time timestamp without time zone null default (now() AT TIME ZONE 'Asia/Manila'::text),
  status text null,
  ip_address text null,
  constraint sanction_access_logs_pkey primary key (id),
  constraint sanction_access_logs_admin_id_fkey foreign KEY (admin_id) references auth.users (id)
) TABLESPACE pg_default;


create table public.sanctions (
  id serial not null,
  student_id text not null,
  student_name text not null,
  event_name text not null,
  penalty text not null,
  fee numeric(10, 2) not null,
  date_given date null default now(),
  status text null default 'pending'::text,
  idstudent_info integer null,
  constraint sanctions_pkey primary key (id),
  constraint unique_student_event_sanction unique (idstudent_info, event_name),
  constraint fk_sanctions_student foreign KEY (idstudent_info) references student_info (idstudent_info)
) TABLESPACE pg_default;


create table public.student_info (
  idstudent_info serial not null,
  student_id character varying(20) not null,
  name character varying(100) not null,
  rfid character varying(50) not null,
  status character varying(10) null default 'active'::character varying,
  year_level text null,
  role character varying(20) null default 'student'::character varying,
  team_id integer null,
  section character varying(10) null,
  password text null,
  constraint student_info_pkey primary key (idstudent_info),
  constraint student_info_rfid_key unique (rfid),
  constraint student_info_student_id_key unique (student_id),
  constraint student_info_team_id_fkey foreign KEY (team_id) references teams (idteam) on delete set null,
  constraint student_info_role_check check (
    (
      (role)::text = any (
        (
          array[
            'admin'::character varying,
            'student'::character varying
          ]
        )::text[]
      )
    )
  ),
  constraint student_info_status_check check (
    (
      (status)::text = any (
        (
          array[
            'active'::character varying,
            'inactive'::character varying
          ]
        )::text[]
      )
    )
  )
) TABLESPACE pg_default;


create table public.teams (
  idteam serial not null,
  team_name character varying(100) not null,
  description text null,
  constraint team_pkey primary key (idteam),
  constraint team_team_name_key unique (team_name)
) TABLESPACE pg_default;

create table public.system_settings (
  key text not null,
  value text not null,
  updated_at timestamp with time zone null default now(),
  constraint system_settings_pkey primary key (key)
) TABLESPACE pg_default;

insert into public.system_settings (key, value)
values ('student_maintenance', 'false')
on conflict (key) do nothing;

insert into public.system_settings (key, value)
values ('force_logout_version', '1')
on conflict (key) do nothing;

