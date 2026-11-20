'use strict';
const cloudClient = supabase.createClient('https://mqzhxhvtfszjypwumizl.supabase.co', 'sb_publishable_ds3d5rThhJvpcVfC7XfpUg_nM_FMVsw', {global:{fetch:configurationFetch}});
let cloudUser = null;
let cloudMessage = 'Inicia sesión para consultar las marcaciones recibidas.';
let cloudBusy = false;
let cloudGeneration = 0;
function renderCloudNotice() {
  if (!cloudUser) return '<strong>Inicia sesión en este dispositivo para ver las lecturas compartidas.</strong> ' +
    'Usa la misma cuenta con acceso al edificio. <a href="#sincronizacion">Iniciar sesión</a>.';
  return '<strong>Cuenta conectada.</strong> <span id="cloud-overview-status" role="status">' + safe(cloudMessage) +
    '</span> <a href="#sincronizacion">Ver sincronización</a>.';
}
function renderCloudPanel() {
  const account = cloudUser
    ? '<p>Sesión de ' + safe(cloudUser.email) + '</p><button class="btn" id="cloud-logout">Cerrar sesión</button>'
    : '<form id="cloud-login"><div class="forms">' +
      '<label class="form-field"><span>Correo</span><input type="email" name="email" autocomplete="username" required></label>' +
      '<label class="form-field"><span>Contraseña</span><input type="password" name="password" autocomplete="current-password" minlength="8" required></label>' +
      '</div><div class="actions"><button class="btn primary" type="submit">Iniciar sesión</button>' +
      '<button class="btn" type="button" id="cloud-register">Crear cuenta</button></div></form>';
  return header('Sincronización', 'El auxiliar Windows envía las marcaciones del lector 5561 a la nube.') +
    '<section class="panel"><h2>Cuenta de acceso</h2>' + account +
    '<p id="cloud-status" role="status">' + safe(cloudMessage) + '</p>' +
    '<p>Las lecturas y la configuración se actualizan cada 15 segundos mientras la página está abierta.</p></section>' + renderReaderHealth() + renderConfigCloudPanel();
}
function cloudStatus(message) {
  cloudMessage = message;
  const node = document.getElementById('cloud-status');
  if (node) node.textContent = message;
  const overview = document.getElementById('cloud-overview-status');
  if (overview) overview.textContent = message;
}
async function refreshCloud() {
  if (!cloudUser || cloudBusy) return;
  cloudBusy = true;
  const generation = cloudGeneration;
  try {
    const { data: buildings, error: buildingsError } = await cloudClient.from('rondas_edificios').select('id,nombre').order('id');
    if (buildingsError) throw buildingsError;
    const rows = [];
    for (const building of buildings) {
      let cursor = 0;
      while (true) {
        const { data, error } = await cloudClient.from('rondas_marcaciones')
          .select('id,edificio,equipo,codigo,fecha').eq('edificio', building.id).gt('id', cursor).order('id').limit(1000);
        if (error) throw error;
        rows.push(...data.map(record => ({
          id: 'cloud-' + record.id, buildingId: record.edificio, device: String(record.equipo),
          code: record.codigo, timestamp: record.fecha.replace(' ', 'T'), source: 'jwm', demo: false
        })));
        if (data.length < 1000) break;
        cursor = data[data.length - 1].id;
      }
    }
    if (generation !== cloudGeneration) return;
    for (const building of buildings) {
      if (!state.buildings.some(item => item.id === building.id)) state.buildings.push({ id: building.id, name: building.nombre, demo: false });
    }
    await configRefresh(buildings, generation);
    await refreshReaderHealth(generation);
    if (generation !== cloudGeneration) return;
    cloudReadings = rows;
    cloudStatus(buildings.length
      ? rows.length + ' marcaciones disponibles. Última consulta ' + new Intl.DateTimeFormat('es-CL', { hour:'2-digit', minute:'2-digit', second:'2-digit' }).format(new Date()) + '.'
      : 'La cuenta está activa. Falta que el administrador le asigne acceso a un edificio.');
    if (!document.getElementById('modal')?.open && !document.activeElement?.matches('input, textarea, select')) render();
  } catch (error) {
    cloudStatus('No se pudo actualizar desde la nube. ' + error.message);
  } finally {
    cloudBusy = false;
  }
}
document.addEventListener('submit', async event => {
  if (event.target.id !== 'cloud-login') return;
  event.preventDefault();
  const form = event.target, values = new FormData(form), button = form.querySelector('button[type="submit"]');
  button.disabled = true;
  try {
    const { error } = await cloudClient.auth.signInWithPassword({ email: values.get('email'), password: values.get('password') });
    if (error) throw error;
    form.reset();
  } catch (error) { cloudStatus('No se pudo iniciar sesión. ' + error.message); }
  finally { button.disabled = false; }
});
document.addEventListener('click', async event => {
  if (event.target.id === 'cloud-register') {
    const form = document.getElementById('cloud-login');
    if (!form.reportValidity()) return;
    const button = event.target;
    button.disabled = true;
    try {
      const values = new FormData(form);
      const { data, error } = await cloudClient.auth.signUp({
        email: values.get('email'), password: values.get('password'),
        options: { emailRedirectTo: 'https://danielchacanam-afk.github.io/control-rondas/#sincronizacion' }
      });
      if (error) throw error;
      form.reset();
      cloudStatus(data.session ? 'Cuenta creada.' : 'Revisa tu correo para confirmar la cuenta. Después podrás iniciar sesión.');
    } catch (error) { cloudStatus('No se pudo crear la cuenta. ' + error.message); }
    finally { button.disabled = false; }
  }
  if (event.target.id === 'cloud-logout') {
    await configurationLock();
    const { error } = await cloudClient.auth.signOut();
    if (error) cloudStatus(error.message);
  }
});
cloudClient.auth.onAuthStateChange((_event, session) => {
  configSetAccount(session?.user);
  cloudGeneration++;
  cloudUser = session?.user || null;
  configurationAccountChanged(cloudUser);
  cloudReadings = [];
  readerHealth = []; readerHealthError = "";
  cloudMessage = cloudUser ? 'Consultando las marcaciones…' : 'Inicia sesión para consultar las marcaciones recibidas.';
  if (!document.getElementById('modal')?.open) render();
  setTimeout(() => refreshCloud(), 0);
});
setInterval(refreshCloud, 15000);

