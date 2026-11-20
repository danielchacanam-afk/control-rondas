'use strict';
let configurationToken = '', configurationDeadline = 0, configurationOpen = false;
let configurationIdentity = null, configurationStatus = null, configurationError = '', configurationLoading = false;
let configurationLastRoute = '', configurationOperation = 0;
const configurationRequests = new Set();
function configurationCanWrite() {
  return Boolean(configurationOpen && configurationToken && Date.now() < configurationDeadline);
}
function configurationFetch(input, init = {}) {
  const url = new URL(typeof input === 'string' ? input : input.url || String(input));
  const guarded = url.origin === 'https://mqzhxhvtfszjypwumizl.supabase.co' &&
    /^\/rest\/v1\/rpc\/rondas_(guardar_configuracion|crear_edificio)$/.test(url.pathname);
  if (!guarded) return fetch(input, init);
  const headers = new Headers(init.headers || (typeof input === 'object' ? input.headers : undefined));
  if (configurationCanWrite()) headers.set('x-rondas-configuracion', configurationToken);
  else headers.delete('x-rondas-configuracion');
  const request = fetch(input, { ...init, headers });
  configurationRequests.add(request);
  request.then(() => configurationRequests.delete(request), () => configurationRequests.delete(request));
  return request;
}
function configurationAccountChanged(user) {
  const identity = user?.id || null;
  if (identity === configurationIdentity) return;
  configurationOperation++;
  configurationIdentity = identity;
  configurationToken = ''; configurationDeadline = 0; configurationOpen = false;
  configurationStatus = null; configurationError = ''; configurationLoading = false;
  if (document.getElementById('modal')?.open) document.getElementById('modal').close();
  if (identity) setTimeout(configurationLoadStatus, 0);
}
async function configurationLoadStatus() {
  if (!configurationIdentity || configurationLoading) return;
  configurationLoading = true;
  const identity = configurationIdentity;
  try {
    const { data, error } = await cloudClient.rpc('rondas_estado_acceso_configuracion');
    if (error) throw error;
    if (identity !== configurationIdentity) return;
    configurationStatus = data; configurationError = '';
  } catch (_) {
    if (identity === configurationIdentity) configurationError = 'No se pudo comprobar el acceso. Revisa la conexión y vuelve a intentar.';
  } finally {
    if (identity === configurationIdentity) {
      configurationLoading = false;
      if (route === 'configuracion' && !configurationCanWrite()) render();
    }
  }
}
function renderConfigurationGate() {
  const title = header('Configuración', 'Acceso protegido con una clave independiente.');
  if (!configurationIdentity) return title + '<section class="panel"><h2>Inicia sesión</h2><p>Para administrar este edificio necesitas una cuenta autorizada y tu clave de Configuración.</p><a class="btn primary" href="#sincronizacion">Iniciar sesión</a></section>';
  if (!configurationStatus) return title + '<section class="panel"><p role="status">' + safe(configurationError || 'Comprobando acceso…') + '</p>' +
    (configurationError ? '<button class="btn" id="configuration-retry">Volver a intentar</button>' : '') + '</section>';
  if (!configurationStatus.administrador) return title + '<section class="panel"><h2>Acceso de administración</h2><p>Tu cuenta puede consultar la información, pero no tiene permiso para modificar la configuración.</p></section>';
  const create = !configurationStatus.configurada;
  return title + '<section class="panel configuration-gate"><h2>' + (create ? 'Crear clave de Configuración' : 'Ingresa la clave de Configuración') + '</h2>' +
    '<p>Cuenta: ' + safe(cloudUser.email) + '</p><p>' +
    (create ? 'Elige una clave de al menos 8 caracteres. Usarás esta misma clave en tus otros dispositivos con esta cuenta.' : 'Esta clave es independiente de tu contraseña para iniciar sesión.') + '</p>' +
    '<form id="configuration-access" autocomplete="off"><div class="forms">' +
    '<label class="form-field"><span>' + (create ? 'Nueva clave' : 'Clave de Configuración') + '</span><input name="clave" type="password" required minlength="8" maxlength="64" autocomplete="' + (create ? 'new-password' : 'off') + '"></label>' +
    (create ? '<label class="form-field"><span>Repite la clave</span><input name="confirmacion" type="password" required minlength="8" maxlength="64" autocomplete="new-password"></label>' : '') +
    '</div><p id="configuration-access-error" role="alert">' + safe(configurationError) + '</p><button class="btn primary" type="submit">' + (create ? 'Crear clave y entrar' : 'Entrar a Configuración') + '</button></form>' +
    '<p>Al salir de Configuración se vuelve a bloquear. El acceso también vence después de 15 minutos.</p></section>';
}
function configurationRequire() {
  if (configurationCanWrite()) return true;
  navigate('configuracion');
  toast('Ingresa la clave de Configuración para hacer cambios');
  return false;
}
async function configurationLock(revoke = true) {
  const token = configurationToken;
  configurationOperation++;
  configurationToken = ''; configurationDeadline = 0; configurationOpen = false; configurationError = '';
  if (document.getElementById('modal')?.open) document.getElementById('modal').close();
  if (route === 'configuracion') render();
  if (token && revoke && configurationIdentity) {
    // Las peticiones ya autorizadas terminan antes de revocar su permiso.
    await Promise.allSettled([...configurationRequests]);
    try { await cloudClient.rpc('rondas_bloquear_configuracion', { permiso: token }); } catch (_) { /* El permiso vence en el servidor. */ }
  }
}
function configurationRouteChanged(next) {
  if (configurationLastRoute === 'configuracion' && next !== 'configuracion') configurationLock();
  configurationLastRoute = next;
}
function renderConfigurationMigration() {
  if (!configurationCanWrite() || !configAllowed.has(state.activeId) || configBases[state.activeId] || configPending[state.activeId]) return '';
  return '<section class="panel"><p>Este edificio aún no tiene configuración compartida. Puedes copiar la de este navegador con un respaldo previo.</p>' +
    '<button class="btn primary" data-config-migrate="' + safe(state.activeId) + '">Compartir configuración de este navegador</button></section>';
}
document.addEventListener('submit', async event => {
  if (event.target.id !== 'configuration-access') return;
  event.preventDefault();
  const form = event.target, values = new FormData(form), button = form.querySelector('button[type="submit"]');
  const create = !configurationStatus?.configurada, clave = values.get('clave');
  if (create && clave !== values.get('confirmacion')) {
    document.getElementById('configuration-access-error').textContent = 'Las claves no coinciden';
    return;
  }
  button.disabled = true;
  const identity = configurationIdentity, operation = ++configurationOperation;
  try {
    const { data, error } = await cloudClient.rpc(create ? 'rondas_definir_clave_configuracion' : 'rondas_desbloquear_configuracion', { clave });
    if (error) throw error;
    if (operation !== configurationOperation || identity !== configurationIdentity || route !== 'configuracion') return;
    if (!data?.ok) throw new Error(data?.mensaje || 'No se pudo desbloquear la configuración');
    form.reset();
    configurationToken = data.permiso;
    configurationDeadline = Math.min(Date.parse(data.vence_en), Date.now() + 15 * 60 * 1000);
    configurationOpen = true;
    configurationStatus = { administrador: true, configurada: true }; configurationError = '';
    render();
    await configFlush();
  } catch (error) {
    if (operation !== configurationOperation || identity !== configurationIdentity) return;
    if (create && error.code === 'PT409') {
      configurationStatus.configurada = true;
      configurationError = 'La clave ya fue creada. Ingresa tu clave de Configuración.';
      render();
      return;
    }
    configurationError = error.message;
    const message = document.getElementById('configuration-access-error');
    if (message) message.textContent = configurationError;
  } finally { button.disabled = false; }
});
document.addEventListener('click', event => {
  if (event.target.id === 'configuration-retry') configurationLoadStatus();
  if (event.target.id === 'configuration-lock') configurationLock();
});
setInterval(() => {
  if (configurationToken && Date.now() >= configurationDeadline) {
    configurationLock();
    toast('El acceso a Configuración venció. Ingresa la clave nuevamente.');
  }
}, 1000);
window.addEventListener('pagehide', () => {
  configurationToken = ''; configurationOpen = false; configurationOperation++;
});
window.addEventListener('pageshow', event => { if (event.persisted) render(); });
