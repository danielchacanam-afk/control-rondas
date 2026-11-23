'use strict';
// Versiones por edificio y cola durable, separada por cuenta.
const CONFIG_COLLECTIONS = ['points', 'employees', 'schedules', 'devices', 'readings', 'history'];
let configAccount = null, configPending = {}, configBases = {}, configAllowed = new Set();
let configSending = false, configConflicts = new Set(), configMessage = 'Consultando la configuración compartida…';
let configLocalState = null, configEpoch = 0;
let configKnownBuildings = new Set();
let configDrafts = {};
const configClone = value => JSON.parse(JSON.stringify(value));
const configCanonical = value => JSON.stringify(value, function (_key, item) {
  if (item && typeof item === 'object' && !Array.isArray(item)) return Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]]));
  return item;
});
const configKey = () => 'control-rondas-cloud-config-' + configAccount;
function configSnapshot(buildingId) {
  const result = { building: configClone(state.buildings.find(b => b.id === buildingId)) };
  for (const collection of CONFIG_COLLECTIONS) {
    result[collection] = configClone(state[collection].filter(item => item.buildingId === buildingId && !item.demo));
  }
  return result;
}
function configApply(data) {
  const buildingId = data.building.id;
  state.buildings = state.buildings.filter(b => b.id !== buildingId).concat(configClone(data.building));
  for (const collection of CONFIG_COLLECTIONS) {
    state[collection] = state[collection].filter(item => item.buildingId !== buildingId).concat(configClone(data[collection]));
  }
}
function configCache() {
  localStorage.setItem(configKey(), JSON.stringify({ pending: configPending, bases: configBases, drafts: configDrafts }));
}
function configSetAccount(user) {
  configEpoch++;
  if (configAccount === (user?.id || null)) return;
  if (configAccount && configLocalState) state = configClone(configLocalState);
  configAccount = user?.id || null;
  configPending = {}; configBases = {}; configDrafts = {}; configAllowed = new Set(); configConflicts = new Set();
  configMessage = 'Consultando la configuración compartida…';
  if (!configAccount) return;
  configLocalState = configClone(state);
  configKnownBuildings = new Set(state.buildings.map(b => b.id));
  try {
    const cached = JSON.parse(localStorage.getItem(configKey()) || '{}');
    configPending = cached.pending || {}; configBases = cached.bases || {};
    configDrafts = cached.drafts || {};
    configAllowed = new Set([...Object.keys(configBases), ...Object.keys(configPending), ...Object.keys(configDrafts)]);
    for (const draft of Object.values(configDrafts)) configApply(draft);
    for (const [buildingId, base] of Object.entries(configBases)) configApply(configPending[buildingId]?.data || base.data);
  } catch (_) { configPending = {}; configBases = {}; }
}
// Invocado por save() después de las ediciones, sin almacenar datos de la cuenta en la copia local heredada.
function persistCloudState() {
  if (!configAccount) return false;
  for (const building of state.buildings) {
    if (!building.demo && !configKnownBuildings.has(building.id)) {
      configKnownBuildings.add(building.id); configAllowed.add(building.id);
      configPending[building.id] = { revision: 0, data: configSnapshot(building.id), create: true };
    }
  }
  for (const buildingId of configAllowed) {
    const base = configBases[buildingId] || (configPending[buildingId]?.create ? { revision: 0, data: configPending[buildingId].data } : null);
    if (!base) { configDrafts[buildingId] = configSnapshot(buildingId); continue; }
    const data = configSnapshot(buildingId);
    const previous = configPending[buildingId]?.data || base.data;
    if (configCanonical(data) !== configCanonical(previous)) {
      configPending[buildingId] = { ...configPending[buildingId], revision: base.revision, data };
    }
  }
  configCache();
  setTimeout(configFlush, 0);
  return true;
}
async function configRefresh(buildings, generation) {
  const { data, error } = await cloudClient.from('rondas_configuraciones').select('edificio,revision,datos');
  if (error) throw error;
  if (generation !== cloudGeneration) return;
  configAllowed = new Set([...buildings.map(b => b.id), ...Object.keys(configPending).filter(b => configPending[b].create)]);
  for (const row of data) {
    const pending = configPending[row.edificio];
    if (pending) {
      // Recupera una respuesta perdida después de una escritura confirmada por el servidor.
      if (!configSending && configCanonical(pending.data) === configCanonical(row.datos)) {
        delete configPending[row.edificio]; configConflicts.delete(row.edificio);
        configBases[row.edificio] = { revision: row.revision, data: row.datos };
        delete configDrafts[row.edificio];
        continue;
      }
      if (pending.revision !== row.revision && !configSending) configConflicts.add(row.edificio);
      continue;
    }
    if ((configBases[row.edificio]?.revision || 0) > row.revision) continue;
    if (configBases[row.edificio]?.revision === row.revision && !configDrafts[row.edificio]) continue;
    // No reemplazar un formulario que el usuario tiene abierto.
    if (document.getElementById('modal')?.open) continue;
    configBases[row.edificio] = { revision: row.revision, data: row.datos };
    delete configDrafts[row.edificio];
    configApply(row.datos);
  }
  configCache();
  await configFlush();
}
async function configFlush() {
  if (!configAccount || configSending) return;
  if (typeof configurationCanWrite === 'function' && !configurationCanWrite()) {
    if (Object.keys(configPending).length) configMessage = 'Hay cambios guardados en este dispositivo. Desbloquea Configuración para enviarlos.';
    return;
  }
  configSending = true;
  const epoch = configEpoch;
  try {
    for (const buildingId of Object.keys(configPending)) {
      if (!configAllowed.has(buildingId) || configConflicts.has(buildingId)) continue;
      const sent = configClone(configPending[buildingId]);
      const args = { destino: buildingId, contenido: sent.data };
      if (!sent.create) args.esperada = sent.revision;
      const { data: revision, error } = await cloudClient.rpc(sent.create ? 'rondas_crear_edificio' : 'rondas_guardar_configuracion', args);
      if (epoch !== configEpoch) return;
      if (error) {
        if (String(error.code) === 'PT409') configConflicts.add(buildingId);
        throw error;
      }
      configBases[buildingId] = { revision, data: sent.data };
      delete configDrafts[buildingId];
      if (configCanonical(configPending[buildingId]?.data) === configCanonical(sent.data)) delete configPending[buildingId];
      else if (configPending[buildingId]) {
        configPending[buildingId].revision = revision; delete configPending[buildingId].create;
      }
      configCache();
    }
    configMessage = Object.keys(configPending).length ? 'Hay cambios pendientes de sincronizar.' : 'Configuración guardada en la nube.';
  } catch (error) {
    configMessage = configConflicts.size
      ? 'Hay una edición desde otro dispositivo. Tus cambios siguen guardados aquí; descarga una copia antes de cargar la versión de la nube.'
      : 'Cambios guardados en este dispositivo, pendientes de envío. Se reintentará al recuperar la conexión. ' + error.message;
  } finally {
    configSending = false;
    const status = document.getElementById('config-status');
    if (status) status.textContent = configMessage;
  }
}
function renderConfigCloudPanel() {
  if (!configAccount) return '';
  const missing = [...configAllowed].filter(buildingId => !configBases[buildingId] && !configPending[buildingId]);
  return '<section class="panel"><h2>Configuración compartida</h2><p id="config-status" role="status">' + safe(configMessage) + '</p>' +
    '<p>Puntos RFID, conserjes, horarios, lectores y lecturas importadas se comparten con tu cuenta. El auxiliar envía las marcaciones aunque cierres esta web.</p>' +
    missing.map(buildingId => '<p>' + safe(state.buildings.find(b => b.id === buildingId)?.name || buildingId) +
      ': aún no tiene configuración compartida.</p><a class="btn" href="#configuracion">Abrir Configuración para autorizar la copia</a>').join('') +
    (configConflicts.size ? '<div class="actions"><button class="btn" id="config-download">Descargar mis cambios pendientes</button>' +
      '<button class="btn" id="config-reload">Cargar versión de la nube</button></div>' : '') +
    '<p>El PC debe estar encendido y el lector conectado por USB. El servicio funciona sin iniciar sesión en Windows; el auxiliar de sesión requiere una sesión abierta. Sin internet conserva las lecturas y reintenta el envío.</p></section>';
}
document.addEventListener('click', async event => {
  const buildingId = event.target.dataset.configMigrate;
  if (buildingId && configAllowed.has(buildingId) && !configBases[buildingId] && !configPending[buildingId]) {
    if (typeof configurationRequire === 'function' && !configurationRequire()) return;
    localStorage.setItem('control-rondas-respaldo-previo-migracion-' + configAccount + '-' + buildingId, JSON.stringify(configSnapshot(buildingId)));
    configPending[buildingId] = { revision: 0, data: configSnapshot(buildingId) };
    configCache();
    await configFlush(); render();
  }
  if (event.target.id === 'config-download') {
    const url = URL.createObjectURL(new Blob([JSON.stringify(configPending, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = 'configuracion-pendiente-rondas.json'; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  if (event.target.id === 'config-reload') {
    if (!confirm('Se cargarán las versiones de la nube. Descarga primero tus cambios pendientes si quieres conservarlos. ¿Continuar?')) return;
    for (const conflict of configConflicts) delete configPending[conflict];
    configConflicts.clear(); configCache(); await refreshCloud();
  }
});
window.addEventListener('online', () => refreshCloud());
