'use strict';
let readerHealth = [], readerHealthError = '';
function healthDate(value) {
  const stamp = new Date(value);
  return value && Number.isFinite(stamp.getTime())
    ? new Intl.DateTimeFormat('es-CL', { timeZone: 'America/Santiago', dateStyle: 'short', timeStyle: 'medium' }).format(stamp)
    : 'Sin registro';
}
function readerState(record, now = Date.now()) {
  const age = now - new Date(record.recibido_en).getTime();
  if (!Number.isFinite(age) || age > 120000) return ['pending', 'Auxiliar sin señal reciente'];
  if (record.estado.usb === 'error') return ['bad', 'Error de lectura USB'];
  if (record.estado.usb === 'disconnected') return ['pending', 'Lector USB desconectado'];
  return ['ok', 'Lector conectado'];
}
function renderReaderHealth() {
  if (!cloudUser) return '';
  const records = readerHealth.filter(row => row.edificio === state.activeId);
  return '<section class="panel"><h2>Estado del lector</h2>' +
    (readerHealthError ? '<p role="status">' + safe(readerHealthError) + '</p>' : '') +
    (!records.length ? '<p>Aún no hay un estado recibido del auxiliar para este edificio.</p>' : records.map(row => {
      const status = row.estado, [css, label] = readerState(row);
      return '<div class="reader-health"><h3>Lector ' + safe(row.equipo) + ' <span class="chip ' + css + '">' + label + '</span></h3>' +
        '<p>Funcionamiento: ' + (status.mode === 'service' ? 'Servicio de Windows' : 'Auxiliar de sesión') +
        (status.port ? ' · Puerto ' + safe(status.port) : '') + '</p>' +
        '<dl><dt>Última señal del auxiliar</dt><dd>' + healthDate(row.recibido_en) + '</dd>' +
        '<dt>Última descarga correcta</dt><dd>' + healthDate(status.last_download) + '</dd>' +
        '<dt>Último envío de marcaciones confirmado</dt><dd>' + (status.last_upload ? healthDate(status.last_upload) : 'Sin envíos nuevos desde la actualización') + '</dd>' +
        '<dt>Marcaciones pendientes de envío</dt><dd>' + safe(status.pending) + '</dd>' +
        '<dt>Marcaciones guardadas en el PC</dt><dd>' + safe(status.total) + '</dd></dl>' +
        (status.usb_error ? '<p class="warning-box">USB: ' + safe(status.usb_error) + '</p>' : '') +
        (status.cloud_error ? '<p class="warning-box">Envío pendiente: ' + safe(status.cloud_error) + '</p>' : '') + '</div>';
    }).join('')) + '<p>El auxiliar informa cada 30 segundos. Si pasan más de 2 minutos sin recibirlo, su estado deja de considerarse actual. Las horas se muestran para Chile.</p></section>';
}
async function refreshReaderHealth(generation) {
  try {
    const { data, error } = await cloudClient.from('rondas_estado_lectores').select('equipo,edificio,recibido_en,estado').order('equipo');
    if (error) throw error;
    if (generation !== cloudGeneration) return;
    readerHealth = data; readerHealthError = '';
  } catch (_) {
    if (generation === cloudGeneration) readerHealthError = 'No se pudo actualizar el estado del auxiliar. La información anterior puede estar desactualizada.';
  }
}
