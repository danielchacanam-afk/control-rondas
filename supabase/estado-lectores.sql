begin;
create table if not exists public.rondas_estado_lectores (
  equipo integer primary key references public.rondas_lectores(equipo),
  edificio text not null,
  recibido_en timestamptz not null default now(),
  estado jsonb not null,
  foreign key(edificio,equipo) references public.rondas_lectores(edificio,equipo)
);
alter table public.rondas_estado_lectores enable row level security;
revoke all on public.rondas_estado_lectores from anon,authenticated;
grant select on public.rondas_estado_lectores to authenticated;
drop policy if exists estado_lector_visible on public.rondas_estado_lectores;
create policy estado_lector_visible on public.rondas_estado_lectores for select to authenticated
 using (exists (select 1 from public.rondas_miembros m where m.edificio=rondas_estado_lectores.edificio));

create or replace function public.rondas_informar_estado(equipo_id integer, estado jsonb)
returns boolean language plpgsql security definer set search_path='' as $$
declare
  token text := coalesce(current_setting('request.headers',true)::jsonb->>'x-rondas-token','');
  destino text;
begin
  if token !~ '^[a-f0-9]{64}$' then
    raise sqlstate 'PT401' using message='Credencial inválida';
  end if;
  select l.edificio into destino from public.rondas_lectores l
    where l.equipo=equipo_id and l.activo and l.token_hash=extensions.digest(token,'sha256');
  if destino is null then raise sqlstate 'PT401' using message='Credencial inválida'; end if;
  if jsonb_typeof(estado) is distinct from 'object' or octet_length(estado::text)>4000
    or coalesce(estado->>'usb','') not in ('connected','disconnected','error')
    or coalesce(estado->>'mode','') not in ('service','session')
    or coalesce(estado->>'pending','') !~ '^[0-9]{1,10}$'
    or coalesce(estado->>'total','') !~ '^[0-9]{1,10}$'
    or (estado->>'pending')::bigint > (estado->>'total')::bigint
    or (estado->>'port' is not null and estado->>'port' !~ '^COM[0-9]{1,5}$') then
    raise sqlstate 'PT400' using message='Estado inválido';
  end if;
  insert into public.rondas_estado_lectores(equipo,edificio,estado) values(equipo_id,destino,estado)
    on conflict(equipo) do update set estado=excluded.estado, edificio=excluded.edificio,recibido_en=now();
  return true;
end;
$$;
revoke all on function public.rondas_informar_estado(integer,jsonb) from public,anon,authenticated;
grant execute on function public.rondas_informar_estado(integer,jsonb) to anon,authenticated;
commit;
