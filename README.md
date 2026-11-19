# Control de Rondas

Interfaz en GitHub Pages, datos autenticados en Supabase y auxiliar Windows para el lector JWM 5561.

## Uso

1. Abrir la web e iniciar sesión en Sincronización con una cuenta que tenga acceso al edificio.
2. Una sola vez, desde el navegador que contiene la configuración original, pulsar Compartir configuración de este navegador. Se conserva un respaldo local antes del primer envío.
3. Puntos RFID, conserjes, horarios, lectores, edificios y lecturas CSV pasan a compartirse por cuenta. Otro dispositivo recibe la configuración al iniciar sesión, con consultas cada 15 segundos.
4. Las ediciones pendientes se conservan por cuenta en el dispositivo y se reintentan al recuperar la conexión. Ante ediciones simultáneas se conserva la versión pendiente para descargarla; no se sobrescribe una versión más reciente.

## Descarga independiente de la web

El auxiliar Windows consulta el lector cada 30 segundos, guarda primero en SQLite y envía a Supabase. Funciona con el navegador cerrado. El PC debe estar encendido y el lector conectado por USB. La instalación del servicio ControlRondasJWM permite arrancar con Windows sin iniciar sesión, bajo LocalService, con reinicio automático ante fallos. El instalador respalda el arranque anterior y copia SQLite de forma consistente a ProgramData. Si falta internet, conserva los registros y reintenta. No borra el lector ni cambia su reloj.

Las nuevas marcaciones se consultan desde cualquier dispositivo con internet y una cuenta autorizada; el lector solo debe conectarse al PC que ejecuta el auxiliar. Registrar un lector en la interfaz no provisiona su credencial de envío: esa vinculación se administra en el backend.

## Base de datos

Aplicar primero supabase/schema.sql y después supabase/configuracion.sql. El segundo archivo crea versiones de configuración y su historial, RLS por edificio y funciones de escritura con revisión esperada. La primera migración usa revisión 0, por lo que otro navegador no puede reemplazarla con su configuración inicial. Las tablas de configuración no aceptan escritura directa del cliente. Los miembros de un edificio pueden editarlo y dar de alta nuevos edificios propios. Las credenciales privadas del lector permanecen fuera de este repositorio.

## Validación

Ejecutar `node --test test/config-cloud.test.cjs`. Cubre migración entre clientes, cola sin red y recarga, conflictos, respuesta perdida, cierre de sesión y edición durante un envío. La migración se validó además en PostgreSQL con usuarios, roles y políticas RLS: acceso anónimo denegado, separación de edificios, rechazo de versiones antiguas y creación de edificio con acceso del creador.

## Límites actuales

- Los informes se calculan al abrir la web. Se conserva el historial de configuración, pero los informes históricos todavía usan las reglas actuales, sin vigencias.
- El calendario no resuelve festivos automáticamente y Fuera de horario usa una heurística de lecturas cercanas a la fecha.
- Los registros del lector no incluyen año; el auxiliar lo infiere y conserva la trama original.
- El botón Leer por Web Serial no descarga por sí solo la memoria JWM. La descarga comprobada se realiza mediante el auxiliar.
- Las cuentas nuevas necesitan asignación de acceso. No hay administración de permisos desde la interfaz.
- El edificio DEMO es local y sus datos ficticios no se comparten.

## Servicio y estado del lector

Aplicar también `supabase/estado-lectores.sql`. El auxiliar informa cada 30 segundos usando la misma credencial privada del lector. En Sincronización se muestran conexión USB, funcionamiento como servicio o sesión, última señal, descarga, envío confirmado, pendientes y errores. Más de 2 minutos sin señal se presenta como información antigua; no se afirma que el USB siga conectado.

El ejecutable se construye con PyInstaller y los módulos de `windows/`. Instalar con `windows/Instalar-servicio.ps1` como administrador; el instalador prueba reinicio controlado, terminación inesperada y recuperación SCM, y comprueba integridad y cantidad de lecturas después. No reinicia el PC. Un reinicio completo y el arranque antes de entrar a Windows requieren una prueba operativa aparte.

Pruebas del auxiliar: `python -m unittest discover -s windows -p test_recovery.py -v` con pyserial y tzdata instalados. Pruebas web: `node --test test/*.test.cjs`. Las pruebas de cortes de internet/USB son simuladas sobre una base temporal, sin desactivar la red ni los dispositivos del PC.

Construcción reproducible: instalar `windows/requirements-build.txt` y ejecutar `windows/Construir.ps1 -Python <ruta-python> -Destination <carpeta-salida>`. El script incluye los datos TLS requeridos por el runtime cuando existen y comprueba que el ejecutable crea un contexto TLS válido antes de instalar. El instalador rechaza paquetes que no pasan esa prueba.
