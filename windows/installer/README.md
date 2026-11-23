# Instalador privado de traslado

Genera un EXE para Windows 10 1803 o posterior / Windows 11, de 64 bits. El instalador incorpora el auxiliar completo, el controlador CP210x oficial sin modificar, su licencia, una copia consistente de SQLite y la conexión del lector 5561 de Brown Norte.

**El EXE y el ZIP del paquete contienen credenciales del lector. Son privados y no se publican en GitHub.** No incluyen contraseñas de usuarios de la web. En el destino, la credencial queda protegida con DPAPI LocalMachine y permisos para SYSTEM, administradores y LocalService.

## Construcción

1. Construir el auxiliar con `../Construir.ps1` y las dependencias de `../requirements-build.txt`.
2. Obtener y verificar el paquete CP210x Universal Windows Driver desde Silicon Labs; conservar todos los archivos y la licencia del proveedor. El usuario debe aceptar esa licencia antes de instalar.
3. Crear una carpeta de trabajo privada con acceso exclusivo del propietario, SYSTEM y administradores.
4. Ejecutar `Preparar-paquete.py` con las rutas `--program`, `--driver`, `--data`, `--private` y `--output`. `--data` es la carpeta del auxiliar actual; SQLite se copia mediante la API de backup sin detener el servicio. Se pueden añadir licencias de dependencias con `--license Nombre=Ruta`.
5. Ejecutar `Compilar-instalador.ps1 -Payload <zip-privado> -OutputFile <exe-privado> -BuildDirectory <carpeta-de-trabajo>`. Usa el compilador de .NET Framework de Windows y restringe los permisos del EXE.

La creación del paquete no cambia el servicio instalado, sus lecturas ni las claves de Supabase. El EXE no tiene firma digital de editor comercial.

## Pruebas sin modificar la instalación real

- `Instalar-Control-de-Rondas.exe /verify`: comprueba el recurso incorporado.
- `/extract <carpeta-nueva-privada>`: extrae con verificación de integridad y protección contra rutas fuera del destino.
- `Instalar.ps1 -StageRoot <extraído> -UserSid <SID-actual> -PrepareOnly -TestRoot <carpeta-aislada>`: prueba copia, preservación de datos, DPAPI y lectura de la conexión desde el EXE congelado. Omite controlador, servicio, registro y accesos del sistema.
- `/render <png>`: genera una vista de la ventana sin instalar.

Se probaron preparación inicial, reinstalación conservando nuevas lecturas, integridad de SQLite y credenciales protegidas. La instalación real del controlador y del servicio debe comprobarse en el computador de destino.

## Uso

En el PC anterior, abrir el EXE y pulsar **Desactivar este PC**. Se detiene el servicio y se deshabilita su inicio, conservando los datos. Copiar el mismo EXE al nuevo computador, aceptar la licencia del controlador y pulsar **Instalar**. Windows solicitará elevación. Conectar el lector después y comprobar una marcación en la web.

La reinstalación conserva la base existente y respalda la instalación anterior. La desinstalación desde Aplicaciones de Windows conserva los datos en ProgramData y no elimina el controlador compartido.

## Versión 2.2: indicador junto al reloj

El paquete incluye `ControlRondasIndicador.exe`. Se inicia con la sesión del usuario que instala, sin elevación, mediante una tarea programada. El servicio mantiene su arranque automático independiente de la sesión.

El icono diferencia conexión USB verificada, puerto detectado sin confirmar y desconexión/error. Incluye notificaciones, sonido configurable y detalle de última descarga y envío. El instalador actualiza y respalda el programa anterior conservando SQLite; desactivar este PC también deshabilita el indicador.

`-PrepareOnly` verifica los dos ejecutables, datos y conexión en una carpeta aislada; no registra la tarea ni cambia el servicio real. La instalación completa debe ejecutarse en el PC que utilizará el USB.
