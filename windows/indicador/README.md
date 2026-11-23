# Indicador integrado del lector

`ControlRondasIndicador.exe` es la interfaz de sesión del mismo auxiliar. El servicio `ControlRondasJWM` sigue descargando y enviando lecturas sin que haya sesión iniciada. La interfaz no abre COM, no utiliza las DLL de JWM y no lee las credenciales de Supabase.

- Verde: el servicio identificó al JWM 5561 y confirmó una respuesta USB reciente después de detectar la conexión.
- Amarillo: Windows detectó el CP210x, pero todavía falta confirmar al lector.
- Rojo: desconectado, error de comunicación, servicio detenido o sin respuesta reciente.

La presencia del puerto se comprueba cada segundo. Las notificaciones de cambio de puerto invalidan una confirmación anterior. El estado compartido se lee permitiendo reemplazo atómico del archivo. La confirmación USB se publica antes de esperar el envío a internet.

Hay un aviso de Windows y sonido al conectar o perder la conexión. El sonido se puede desactivar desde el menú del icono. Doble clic abre el estado, última descarga y pendientes. Cerrar la ventana solo la oculta; «Cerrar indicador» no detiene el servicio.

El instalador registra una tarea al iniciar sesión, con el usuario original y privilegios limitados. También crea el acceso «Estado del lector» en el menú Inicio. Al desactivar o desinstalar se detiene la interfaz y se deshabilita o elimina su tarea.

## Compilar y probar

`../Construir.ps1` construye el servicio y este indicador en la misma carpeta. También se puede usar `Construir.ps1 -Destination <carpeta>`; requiere el compilador de .NET Framework de Windows.

Compilar `Estado.cs` y `Pruebas.cs` como aplicación de consola permite verificar el modelo de conexión sin tocar el USB. `ControlRondasIndicador.exe --render <png> green` genera una vista de prueba; también admite `yellow` o `red`. Estas vistas no acreditan el estado de un lector real.

Las preferencias de sonido se guardan por usuario en `%LOCALAPPDATA%\Control de Rondas\indicador.json`. Los datos y la conexión del servicio permanecen en `%PROGRAMDATA%\Control de Rondas`.
