begin;

-- Una versión completa por edificio. Las marcaciones originales siguen separadas.
create table if not exists public.rondas_configuraciones (
  edificio text primary key references public.rondas_edificios(id),
  revision bigint not null check (revision > 0),
  datos jsonb not null,
  actualizado_en timestamptz not null default now(),
  actualizado_por uuid not null references auth.users(id)
);
create table if not exists public.rondas_configuraciones_historial (
  edificio text not null references public.rondas_edificios(id),
  revision bigint not null,
  datos jsonb not null,
  actualizado_en timestamptz not null,
  actualizado_por uuid not null references auth.users(id),
  primary key (edificio, revision)
);
alter table public.rondas_configuraciones enable row level security;
alter table public.rondas_configuraciones_historial enable row level security;
revoke all on public.rondas_configuraciones, public.rondas_configuraciones_historial from anon, authenticated;
grant select on public.rondas_configuraciones, public.rondas_configuraciones_historial to authenticated;
drop policy if exists configuracion_visible on public.rondas_configuraciones;
create policy configuracion_visible on public.rondas_configuraciones for select to authenticated
  using (exists (select 1 from public.rondas_miembros m where m.edificio = rondas_configuraciones.edificio));
drop policy if exists historial_visible on public.rondas_configuraciones_historial;
create policy historial_visible on public.rondas_configuraciones_historial for select to authenticated
  using (exists (select 1 from public.rondas_miembros m where m.edificio = rondas_configuraciones_historial.edificio));

create or replace function public.rondas_guardar_configuracion(destino text, esperada bigint, contenido jsonb)
returns bigint language plpgsql security definer set search_path = '' as $$
declare
  usuario uuid := auth.uid();
  actual bigint;
  coleccion text;
begin
  if usuario is null or not exists (
    select 1 from public.rondas_miembros where edificio=destino and rondas_miembros.usuario=auth.uid()
  ) then
    raise sqlstate 'PT403' using message='No tienes acceso a este edificio';
  end if;
  if esperada is null or esperada < 0 or jsonb_typeof(contenido) is distinct from 'object'
     or octet_length(contenido::text) > 4000000
     or contenido->'building'->>'id' is distinct from destino
     or length(trim(coalesce(contenido->'building'->>'name',''))) not between 1 and 200 then
    raise sqlstate 'PT400' using message='Configuración inválida';
  end if;
  foreach coleccion in array array['points','employees','schedules','devices','readings','history'] loop
    if jsonb_typeof(contenido->coleccion) is distinct from 'array' then
      raise sqlstate 'PT400' using message='Colección inválida: ' || coleccion;
    end if;
    if exists (select 1 from jsonb_array_elements(contenido->coleccion) e
      where jsonb_typeof(e) is distinct from 'object' or e->>'buildingId' is distinct from destino) then
      raise sqlstate 'PT400' using message='Registros de otro edificio';
    end if;
  end loop;
  -- El bloqueo del edificio serializa también la primera escritura (revision 0).
  perform 1 from public.rondas_edificios where id=destino for update;
  select revision into actual from public.rondas_configuraciones where edificio=destino;
  if coalesce(actual,0) <> esperada then
    raise sqlstate 'PT409' using message='La configuración cambió en otro dispositivo';
  end if;
  actual := coalesce(actual,0)+1;
  insert into public.rondas_configuraciones values(destino,actual,contenido,now(),usuario)
    on conflict(edificio) do update set revision=excluded.revision, datos=excluded.datos,
      actualizado_en=excluded.actualizado_en, actualizado_por=excluded.actualizado_por;
  insert into public.rondas_configuraciones_historial values(destino,actual,contenido,now(),usuario);
  update public.rondas_edificios set nombre=contenido->'building'->>'name' where id=destino;
  return actual;
end;
$$;
revoke all on function public.rondas_guardar_configuracion(text,bigint,jsonb) from public,anon,authenticated;
grant execute on function public.rondas_guardar_configuracion(text,bigint,jsonb) to authenticated;

-- Los miembros actuales pueden dar de alta un edificio, conservando acceso a él.
create or replace function public.rondas_crear_edificio(destino text, contenido jsonb)
returns bigint language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or not exists (select 1 from public.rondas_miembros where usuario=auth.uid()) then
    raise sqlstate 'PT403' using message='Se requiere una cuenta con acceso a un edificio';
  end if;
  if destino !~ '^[a-z0-9-]{1,80}$' or destino is null then
    raise sqlstate 'PT400' using message='Identificador inválido';
  end if;
  insert into public.rondas_edificios(id,nombre) values(destino,contenido->'building'->>'name');
  insert into public.rondas_miembros(edificio,usuario) values(destino,auth.uid());
  return public.rondas_guardar_configuracion(destino,0,contenido);
end;
$$;
revoke all on function public.rondas_crear_edificio(text,jsonb) from public,anon,authenticated;
grant execute on function public.rondas_crear_edificio(text,jsonb) to authenticated;
commit;
