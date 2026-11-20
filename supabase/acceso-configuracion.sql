begin;

-- Los miembros existentes ya podían editar. Conservan ese rol; los nuevos son lectores.
alter table public.rondas_miembros add column if not exists rol text;
update public.rondas_miembros set rol='administrador' where rol is null;
alter table public.rondas_miembros alter column rol set default 'lector';
alter table public.rondas_miembros alter column rol set not null;
do $$ begin
  if not exists(select 1 from pg_constraint where conname='rondas_miembros_rol_valido' and conrelid='public.rondas_miembros'::regclass) then
    alter table public.rondas_miembros add constraint rondas_miembros_rol_valido check(rol in ('lector','administrador'));
  end if;
end $$;

create table if not exists public.rondas_claves_configuracion (
  usuario uuid primary key references auth.users(id) on delete cascade,
  clave_hash text not null,
  fallos integer not null default 0,
  bloqueado_hasta timestamptz
);
create table if not exists public.rondas_permisos_configuracion (
  token_hash bytea primary key,
  usuario uuid not null references auth.users(id) on delete cascade,
  vence_en timestamptz not null
);
create index if not exists rondas_permisos_usuario on public.rondas_permisos_configuracion(usuario,vence_en);
alter table public.rondas_claves_configuracion enable row level security;
alter table public.rondas_permisos_configuracion enable row level security;
revoke all on public.rondas_claves_configuracion,public.rondas_permisos_configuracion from public,anon,authenticated;

create or replace function public.rondas_estado_acceso_configuracion()
returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_build_object(
    'administrador',exists(select 1 from public.rondas_miembros where usuario=auth.uid() and rol='administrador'),
    'configurada',exists(select 1 from public.rondas_claves_configuracion where usuario=auth.uid())
  );
$$;

create or replace function public.rondas_emitir_permiso_configuracion()
returns jsonb language plpgsql security definer set search_path='' as $$
declare token text; vence timestamptz:=now()+interval '15 minutes';
begin
  if auth.uid() is null or not exists(select 1 from public.rondas_miembros where usuario=auth.uid() and rol='administrador') then
    raise sqlstate 'PT403' using message='Se requiere una cuenta administradora';
  end if;
  delete from public.rondas_permisos_configuracion where usuario=auth.uid() and vence_en<=now();
  if (select count(*) from public.rondas_permisos_configuracion where usuario=auth.uid())>=10 then
    delete from public.rondas_permisos_configuracion where token_hash in (
      select token_hash from public.rondas_permisos_configuracion where usuario=auth.uid() order by vence_en limit 1
    );
  end if;
  token:=encode(extensions.gen_random_bytes(32),'hex');
  insert into public.rondas_permisos_configuracion values(extensions.digest(token,'sha256'),auth.uid(),vence);
  return jsonb_build_object('ok',true,'permiso',token,'vence_en',vence);
end;
$$;

create or replace function public.rondas_definir_clave_configuracion(clave text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare inserted integer;
begin
  if auth.uid() is null or not exists(select 1 from public.rondas_miembros where usuario=auth.uid() and rol='administrador') then
    raise sqlstate 'PT403' using message='Se requiere una cuenta administradora';
  end if;
  if clave is null or length(clave)<8 or length(clave)>64 or octet_length(clave)>72 then
    raise sqlstate 'PT400' using message='Usa una clave de al menos 8 caracteres y no demasiado larga';
  end if;
  insert into public.rondas_claves_configuracion(usuario,clave_hash)
    values(auth.uid(),extensions.crypt(clave,extensions.gen_salt('bf',10))) on conflict do nothing;
  get diagnostics inserted=row_count;
  if inserted=0 then raise sqlstate 'PT409' using message='Esta cuenta ya tiene una clave de Configuración'; end if;
  return public.rondas_emitir_permiso_configuracion();
end;
$$;

create or replace function public.rondas_desbloquear_configuracion(clave text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare saved public.rondas_claves_configuracion%rowtype; attempts integer;
begin
  if auth.uid() is null or not exists(select 1 from public.rondas_miembros where usuario=auth.uid() and rol='administrador') then
    raise sqlstate 'PT403' using message='Se requiere una cuenta administradora';
  end if;
  select * into saved from public.rondas_claves_configuracion where usuario=auth.uid() for update;
  if not found then return jsonb_build_object('ok',false,'mensaje','Primero crea tu clave de Configuración'); end if;
  if saved.bloqueado_hasta>now() then
    return jsonb_build_object('ok',false,'mensaje','Demasiados intentos. Espera cinco minutos antes de volver a intentar.');
  end if;
  if clave is null or octet_length(clave)>72 or extensions.crypt(clave,saved.clave_hash) is distinct from saved.clave_hash then
    attempts:=saved.fallos+1;
    update public.rondas_claves_configuracion set
      fallos=case when attempts>=5 then 0 else attempts end,
      bloqueado_hasta=case when attempts>=5 then now()+interval '5 minutes' else null end
      where usuario=auth.uid();
    -- Se devuelve el fallo para conservar el contador dentro de la transacción.
    return jsonb_build_object('ok',false,'mensaje',case when attempts>=5 then 'Demasiados intentos. Espera cinco minutos antes de volver a intentar.' else 'Clave incorrecta' end);
  end if;
  update public.rondas_claves_configuracion set fallos=0,bloqueado_hasta=null where usuario=auth.uid();
  return public.rondas_emitir_permiso_configuracion();
end;
$$;

create or replace function public.rondas_configuracion_autorizada(destino text default null)
returns boolean language sql stable security definer set search_path='' as $$
  select auth.uid() is not null
    and exists(select 1 from public.rondas_miembros where usuario=auth.uid() and rol='administrador' and (destino is null or edificio=destino))
    and exists(select 1 from public.rondas_permisos_configuracion where usuario=auth.uid() and vence_en>now()
      and token_hash=extensions.digest(coalesce(current_setting('request.headers',true)::jsonb->>'x-rondas-configuracion',''),'sha256'));
$$;

create or replace function public.rondas_bloquear_configuracion(permiso text)
returns boolean language plpgsql security definer set search_path='' as $$
begin
  delete from public.rondas_permisos_configuracion where usuario=auth.uid() and token_hash=extensions.digest(permiso,'sha256');
  return true;
end;
$$;

-- La validación de configuración existente se conserva en una función privada.
do $$ begin
  if to_regprocedure('public.rondas_guardar_configuracion_interna(text,bigint,jsonb)') is null then
    alter function public.rondas_guardar_configuracion(text,bigint,jsonb) rename to rondas_guardar_configuracion_interna;
  end if;
end $$;
revoke all on function public.rondas_guardar_configuracion_interna(text,bigint,jsonb) from public,anon,authenticated;

create or replace function public.rondas_guardar_configuracion(destino text,esperada bigint,contenido jsonb)
returns bigint language plpgsql security definer set search_path='' as $$
begin
  if not public.rondas_configuracion_autorizada(destino) then
    raise sqlstate 'PT403' using message='Desbloquea Configuración con tu clave para guardar cambios';
  end if;
  return public.rondas_guardar_configuracion_interna(destino,esperada,contenido);
end;
$$;

create or replace function public.rondas_crear_edificio(destino text,contenido jsonb)
returns bigint language plpgsql security definer set search_path='' as $$
begin
  if not public.rondas_configuracion_autorizada() then
    raise sqlstate 'PT403' using message='Desbloquea Configuración con tu clave para crear edificios';
  end if;
  if destino is null or destino !~ '^[a-z0-9-]{1,80}$' then raise sqlstate 'PT400' using message='Identificador inválido'; end if;
  insert into public.rondas_edificios(id,nombre) values(destino,contenido->'building'->>'name');
  insert into public.rondas_miembros(edificio,usuario,rol) values(destino,auth.uid(),'administrador');
  return public.rondas_guardar_configuracion(destino,0,contenido);
end;
$$;

revoke all on function public.rondas_emitir_permiso_configuracion(),public.rondas_configuracion_autorizada(text) from public,anon,authenticated;
revoke all on function public.rondas_estado_acceso_configuracion(),public.rondas_definir_clave_configuracion(text),
  public.rondas_desbloquear_configuracion(text),public.rondas_bloquear_configuracion(text),
  public.rondas_guardar_configuracion(text,bigint,jsonb),public.rondas_crear_edificio(text,jsonb) from public,anon,authenticated;
grant execute on function public.rondas_estado_acceso_configuracion(),public.rondas_definir_clave_configuracion(text),
  public.rondas_desbloquear_configuracion(text),public.rondas_bloquear_configuracion(text),
  public.rondas_guardar_configuracion(text,bigint,jsonb),public.rondas_crear_edificio(text,jsonb) to authenticated;
notify pgrst,'reload schema';
commit;
