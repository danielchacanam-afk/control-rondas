const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const code = fs.readFileSync(require('node:path').join(__dirname, '../config-cloud.js'), 'utf8');
function browser(server, storage = new Map()) {
  const handlers = {};
  const ctx = vm.createContext({
    state: { buildings: [{ id: 'brown-norte', name: 'Brown Norte' }], points: [], employees: [], schedules: [], devices: [], readings: [], history: [] },
    cloudGeneration: 1,
    document: { getElementById: () => null, addEventListener: (name, callback) => { handlers[name] = callback; } },
    localStorage: { setItem: (key, value) => storage.set(key, value), getItem: key => storage.get(key) },
    window: { addEventListener() {} }, setTimeout() {}, safe: String, render() {}, confirm: () => true,
    cloudClient: {
      from: () => ({ select: async () => ({ data: [...server.rows.entries()].map(([edificio, row]) => ({ edificio, ...structuredClone(row) })) }) }),
      rpc: async (name, args) => {
        if (server.offline) return { error: { message: 'offline' } };
        if (server.pause) await server.pause();
        const row = server.rows.get(args.destino);
        if ((row?.revision || 0) !== (args.esperada || 0)) return { error: { code: 'PT409', message: 'conflict' } };
        const revision = (row?.revision || 0) + 1;
        server.rows.set(args.destino, { revision, datos: structuredClone(args.contenido) });
        if (server.lostResponse) return { error: { message: 'connection lost' } };
        return { data: revision };
      }
    }
  });
  vm.runInContext(code, ctx);
  return {
    run: expression => vm.runInContext(expression, ctx),
    login: () => vm.runInContext("configSetAccount({id:'owner'})", ctx),
    refresh: () => vm.runInContext("configRefresh([{id:'brown-norte'}], 1)", ctx),
    migrate: () => handlers.click({ target: { dataset: { configMigrate: 'brown-norte' } } }),
    ctx, storage
  };
}
test('la primera migración es explícita; otro dispositivo recibe la misma configuración', async () => {
  const server = { rows: new Map() }, first = browser(server);
  first.login(); await first.refresh();
  assert.equal(server.rows.size, 0);
  first.run("state.points.push({id:'p1',buildingId:'brown-norte',name:'Sala de Bombas',code:'25A0'})");
  await first.migrate();
  const second = browser(server); second.login(); await second.refresh();
  assert.equal(second.run('state.points[0].code'), '25A0');
  assert.equal(second.run('configBases["brown-norte"].revision'), 1);
});
test('una edición sin red persiste al recargar y se envía al reconectar', async () => {
  const server = { rows: new Map() }, first = browser(server);
  first.login(); await first.refresh(); await first.migrate(); server.offline = true;
  first.run("state.employees.push({id:'e1',buildingId:'brown-norte',name:'Conserje'}); persistCloudState()");
  await first.run('configFlush()');
  const reloaded = browser(server, first.storage); reloaded.login();
  assert.equal(reloaded.run('state.employees[0].name'), 'Conserje');
  server.offline = false; await reloaded.refresh();
  assert.equal(server.rows.get('brown-norte').revision, 2);
  assert.equal(reloaded.run('Object.keys(configPending).length'), 0);
});
test('dos ediciones simultáneas conservan la pendiente y no sobrescriben la nube', async () => {
  const server = { rows: new Map() }, first = browser(server), second = browser(server);
  first.login(); await first.refresh(); await first.migrate(); second.login(); await second.refresh();
  first.run("state.buildings[0].name='Edición A'; persistCloudState()"); await first.run('configFlush()');
  second.run("state.buildings[0].name='Edición B'; persistCloudState()"); await second.run('configFlush()');
  assert.equal(server.rows.get('brown-norte').datos.building.name, 'Edición A');
  assert.equal(second.run('configConflicts.size'), 1);
  assert.equal(second.run('configPending["brown-norte"].data.building.name'), 'Edición B');
});
test('una respuesta perdida se recupera sin conflicto incluso con claves JSONB reordenadas', async () => {
  const server = { rows: new Map(), lostResponse: true }, first = browser(server);
  first.login(); await first.refresh(); await first.migrate();
  const data = server.rows.get('brown-norte').datos;
  server.rows.get('brown-norte').datos = Object.fromEntries(Object.entries(data).reverse());
  server.lostResponse = false; await first.refresh();
  assert.equal(first.run('configConflicts.size'), 0);
  assert.equal(first.run('Object.keys(configPending).length'), 0);
  assert.equal(server.rows.get('brown-norte').revision, 1);
});
test('cerrar sesión restaura la copia local y no muestra la configuración privada a otra cuenta', async () => {
  const server = { rows: new Map() }, first = browser(server);
  first.login(); await first.refresh(); await first.migrate();
  first.run("state.employees.push({id:'e1',buildingId:'brown-norte',name:'Privado'}); persistCloudState()");
  await first.run('configFlush()'); first.run('configSetAccount(null)');
  assert.equal(first.run('state.employees.length'), 0);
  first.run("configSetAccount({id:'another'})"); assert.equal(first.run('state.employees.length'), 0);
});
test('una modificación durante el envío conserva la nueva edición para el siguiente envío', async () => {
  const server = { rows: new Map() }, first = browser(server);
  first.login(); await first.refresh(); await first.migrate();
  first.run("state.buildings[0].name='Primera'; persistCloudState()");
  let release; server.pause = () => new Promise(resolve => { release = resolve; });
  const sending = first.run('configFlush()');
  first.run("state.buildings[0].name='Segunda'; persistCloudState()");
  release(); await sending; delete server.pause; await first.run('configFlush()');
  assert.equal(server.rows.get('brown-norte').datos.building.name, 'Segunda');
  assert.equal(server.rows.get('brown-norte').revision, 3);
});
