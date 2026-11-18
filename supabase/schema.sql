begin;
create extension if not exists pgcrypto with schema extensions;

create table if not exists public.rondas_edificios (
  id text primary key,
  nombre text not null
);
create table if not exists public.rondas_miembros (
  edificio text not null references public.rondas_edificios(id) on delete cascade,
  usuario uuid not null references auth.users(id) on delete cascade,
  primary key (edificio, usuario)
);
create table if not exists public.rondas_lectores (
  equipo integer primary key,
  edificio text not null references public.rondas_edificios(id),
  token_hash bytea not null,
  activo boolean not null default true,
  unique (edificio, equipo)
);
create table if not exists public.rondas_marcaciones (
  id bigint generated always as identity primary key,
  edificio text not null,
  equipo integer not null,
  codigo text not null check (codigo ~ '^[0-9A-F]{4}$'),
  fecha timestamp without time zone not null,
  trama text not null check (trama ~ '^[0-9a-f]{14}$'),
  recibido_en timestamptz not null default now(),
  foreign key (edificio, equipo) references public.rondas_lectores(edificio, equipo),
  unique (edificio, equipo, codigo, fecha)
);
create index if not exists rondas_marcaciones_edificio_id
  on public.rondas_marcaciones(edificio,id);

alter table public.rondas_edificios enable row level security;
alter table public.rondas_miembros enable row level security;
alter table public.rondas_lectores enable row level security;
alter table public.rondas_marcaciones enable row level security;
revoke all on public.rondas_edificios, public.rondas_miembros,
  public.rondas_lectores, public.rondas_marcaciones from anon, authenticated;
grant select on public.rondas_edificios, public.rondas_miembros, public.rondas_marcaciones to authenticated;

drop policy if exists rondas_miembro_propio on public.rondas_miembros;
create policy rondas_miembro_propio on public.rondas_miembros for select to authenticated
  using (usuario = (select auth.uid()));
drop policy if exists rondas_edificio_visible on public.rondas_edificios;
create policy rondas_edificio_visible on public.rondas_edificios for select to authenticated
  using (exists (select 1 from public.rondas_miembros m where m.edificio = id));
drop policy if exists rondas_marcaciones_visibles on public.rondas_marcaciones;
create policy rondas_marcaciones_visibles on public.rondas_marcaciones for select to authenticated
  using (exists (select 1 from public.rondas_miembros m where m.edificio = rondas_marcaciones.edificio));

create or replace function public.rondas_recibir(equipo_id integer, lote jsonb)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  token text := coalesce(current_setting('request.headers', true)::jsonb ->> 'x-rondas-token', '');
  destino text;
  ingresadas integer;
begin
  if token !~ '^[a-f0-9]{64}$' then
    raise sqlstate 'PT401' using message = 'Credencial del lector inválida';
  end if;
  select l.edificio into destino from public.rondas_lectores l
    where l.equipo = equipo_id and l.activo
      and l.token_hash = extensions.digest(token, 'sha256');
  if destino is null then
    raise sqlstate 'PT401' using message = 'Credencial del lector inválida';
  end if;
  if jsonb_typeof(lote) is distinct from 'array' then
    raise sqlstate 'PT400' using message = 'Se esperaba un lote de marcaciones';
  end if;
  if jsonb_array_length(lote) not between 1 and 200 then
    raise sqlstate 'PT400' using message = 'Tamaño de lote inválido';
  end if;
  if exists (
    select 1 from jsonb_array_elements(lote) as e
    where jsonb_typeof(e) is distinct from 'object'
       or coalesce(e->>'codigo','') !~ '^[0-9A-F]{4}$'
       or coalesce(e->>'trama','') !~ '^[0-9a-f]{14}$'
       or upper(left(e->>'trama',4)) <> e->>'codigo'
       or coalesce(e->>'fecha','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}$'
  ) then
    raise sqlstate 'PT400' using message = 'Marcación inválida';
  end if;
  insert into public.rondas_marcaciones (edificio,equipo,codigo,fecha,trama)
    select destino,equipo_id,e->>'codigo',(e->>'fecha')::timestamp,e->>'trama'
    from jsonb_array_elements(lote) as e
    on conflict (edificio,equipo,codigo,fecha) do nothing;
  get diagnostics ingresadas = row_count;
  return jsonb_build_object('recibidas',jsonb_array_length(lote),'nuevas',ingresadas);
end;
$$;
revoke all on function public.rondas_recibir(integer,jsonb) from public, anon, authenticated;
grant execute on function public.rondas_recibir(integer,jsonb) to anon, authenticated;

insert into public.rondas_edificios (id,nombre) values ('brown-norte','Brown Norte')
on conflict (id) do nothing;
commit;

