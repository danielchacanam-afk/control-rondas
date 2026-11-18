# Control de Rondas — GitHub Pages (versión inicial)

Interfaz web de control de rondas para edificios en Chile, basada en el formato de cuatro hojas de la planilla de referencia de Brown Norte. La aplicación usa HTML, CSS y JavaScript sin instalación ni herramientas de compilación.

## Qué funciona hoy

- Navegación: Inicio, Lecturas, Calendario, Conserjes, Configuración, Sincronización e Informes.
- Administración **local** de edificios, trabajadores, lectores, puntos RFID (código/nombre/activo) y rondas (tipo de día, turno, inicio, fin, jornada siguiente, responsable y puntos obligatorios).
- Importación CSV con columnas `Fecha y hora`, `Código`, `Punto de control`, `Equipo`. Acepta `;` o `,`, fecha `DD-MM-YYYY HH:mm` o `YYYY-MM-DD HH:mm`, y descarta duplicados por `equipo + fecha/hora + código`.
- Calendario mensual, evaluación de cumplimiento por ventana, estados `Cumplida`, `Incompleta`, `Fuera de horario`, `No realizada`, `Pendiente` y `Sin configurar`.
- Resumen por conserje. Porcentaje: cumplidas / (cumplidas + incompletas + fuera de horario + no realizadas), siempre que la ronda sea evaluable.
- Exportar lecturas a CSV y generar Excel con cuatro hojas usando SheetJS cargado desde CDN. El navegador debe tener conexión a internet para exportar XLSX.
- Edificio de prueba independiente con datos ficticios (puedes añadirlo desde la consola del navegador llamando `demo()`, si necesitas probar antes de importar). No se importan datos reales automáticamente.

## Límites deliberados de esta versión

- **NO descarga datos del lector JWM por USB**; el protocolo del WM-5000V1 está pendiente de validación. La página `Sincronización` indica esto expresamente.
- **NO envía datos a la nube**, no implementa inicio de sesión ni autorización multiusuario. Los datos se guardan en `localStorage` del navegador, y se pueden perder si se borra el almacenamiento. No usar como sistema operativo de producción.
- La evaluación de meses anteriores usa los horarios y códigos actuales; aún no hay versionado de reglas por vigencia.
- El filtro `Fuera de horario` es heurístico (hay lecturas de puntos exigidos cercanas al día, pero ninguna en la ventana). La lógica final se validará con registros reales.
- No hay cálculo automático de festivos. Configurar días especiales será una etapa posterior.
- El número 5561 es el equipo identificado en las fotografías. El 4639 aparece en la planilla de ejemplo como otro equipo histórico; no se mezclan automáticamente.

## Cómo publicar en GitHub Pages

1. Entrar a [github.com/new](https://github.com/new) con la cuenta **danielchacanam-afk**.
2. Crear un repositorio nuevo, por ejemplo `control-rondas`, de visibilidad **Public** para GitHub Pages gratuito (revisar opciones disponibles del plan). No mezclarlo con proyectos existentes.
3. Subir `index.html`, `styles.css`, `app.js`, `README.md` y `.nojekyll` a la raíz del repositorio. También puedes descomprimir el ZIP de entrega y usar «Add file → Upload files».
4. Ir a `Settings → Pages → Build and deployment`, elegir `Deploy from a branch`, rama `main`, carpeta `/ (root)` y guardar.
5. Cuando GitHub indique el despliegue, la dirección será normalmente `https://danielchacanam-afk.github.io/control-rondas/`.

No incluir códigos de acceso ni datos personales confidenciales en el repositorio público.

## Siguiente fase: API + auxiliar Windows

GitHub Pages solo sirve archivos estáticos; para guardar lecturas compartidas se necesita un backend separado, por ejemplo Supabase o una API Node/PostgreSQL.

### Modelo de datos propuesto

`buildings`, `memberships`, `employees`, `devices`, `rfid_points`, `round_schedule_versions`, `schedule_required_points`, `raw_reads`, `sync_batches`, `audit_log`.

### Contrato propuesto del agente

```
POST /api/agent/records
Authorization: Bearer <TOKEN_EXCLUSIVO_DEL_EQUIPO>
Content-Type: application/json

{
  "device_serial":"5561",
  "events":[{"timestamp_local":"2026-11-17T10:14:00","rfid_code":"0445","source_id":"..."}]
}
```

El backend debe validar el token en servidor, asociarlo a un edificio, convertir correctamente America/Santiago a instantes UTC (incluidos los cambios de horario), deduplicar por clave estable, guardar el payload original, y responder con `accepted`, `duplicates`, `rejected`. El token nunca se incorpora al JavaScript público. El agente Windows almacenará eventos de forma duradera en SQLite y reintentará sin duplicar lecturas si cae internet.

**La primera prueba pendiente es leer registros reales del JWM WM-5000V1 con una operación de solo lectura, sin ejecutar comandos de borrado.**

## Licencia y dependencia externa

El exportador `.xlsx` utiliza SheetJS 0.18.5 desde CDNJS. Revisa la licencia correspondiente para su distribución. El resto de los archivos de este prototipo son código del proyecto.
