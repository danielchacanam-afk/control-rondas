const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../cloud.js'),'utf8');
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve}};
function client(){
 const requests=[],events={},timers=[];let authChange,renders=0;
 const control={buildings:[{id:'b',nombre:'Edificio'}],rows:[],config:()=>Promise.resolve(),health:()=>Promise.resolve(),read:null};
 const api={auth:{onAuthStateChange(cb){authChange=cb}},from(table){
  const query={table,cursor:0,building:null,size:1000,select(){return this},order(){return this},eq(_key,value){this.building=value;return this},gt(_key,value){this.cursor=value;return this},limit(n){this.size=n;return this},then(resolve,reject){
   requests.push({table,cursor:this.cursor,building:this.building});
   const response=table==='rondas_edificios'?{data:control.buildings}:control.read?control.read(this):{data:control.rows.filter(r=>r.edificio===this.building&&r.id>this.cursor).slice(0,this.size)};
   return Promise.resolve(response).then(resolve,reject);
  }};return query;
 }};
 const modal={open:false},active={matches:()=>false};
 const c=vm.createContext({Promise,Map,Set,Date,Intl,document:{getElementById:id=>id==='modal'?modal:null,activeElement:active,addEventListener:(n,cb)=>events[n]=cb},supabase:{createClient:()=>api},configurationFetch(){},configurationAccountChanged(){},configSetAccount(){},configRefresh:()=>control.config(),refreshReaderHealth:()=>control.health(),state:{buildings:[{id:'b'}]},route:'calendario',cloudReadings:[],readerHealth:[],readerHealthError:'',render(){renders++},setTimeout:fn=>timers.push(fn),setInterval(){}});
 vm.runInContext(source,c);
 return {c,control,requests,events,timers,modal,active,run:s=>vm.runInContext(s,c),auth:(id='user')=>authChange('SIGNED_IN',id?{user:{id,email:id+'@test.invalid'}}:null),refresh:()=>vm.runInContext('refreshCloud()',c),get renders(){return renders}};
}
const row=id=>({id,edificio:'b',equipo:5561,codigo:'A1',fecha:'2026-11-23 10:00:00'});
test('las consultas siguientes piden solo filas nuevas y conservan las anteriores',async()=>{
 const t=client();t.auth();t.control.rows=[row(1),row(2)];await t.refresh();t.control.rows.push(row(3));await t.refresh();
 assert.equal(t.run('cloudReadings.length'),3);assert.deepEqual(t.requests.filter(r=>r.table==='rondas_marcaciones').map(r=>r.cursor),[0,2]);await t.refresh();assert.equal(t.run('cloudReadings.length'),3);
});
test('las lecturas aparecen antes de terminar la configuración y el estado USB',async()=>{
 const t=client(),config=deferred(),health=deferred();t.auth();t.control.rows=[row(1)];t.control.config=()=>config.promise;t.control.health=()=>health.promise;const loading=t.refresh();await new Promise(setImmediate);
 assert.equal(t.run('cloudReadings.length'),1);assert.ok(t.renders>=2);await loading;assert.equal(t.run('cloudBusy'),false);t.control.rows.push(row(2));await t.refresh();assert.equal(t.run('cloudReadings.length'),2);config.resolve();health.resolve();
});
test('entradas simultáneas comparten la consulta que ya está en curso',async()=>{
 const t=client(),pending=deferred();t.auth();t.control.read=()=>pending.promise;const a=t.refresh(),b=t.refresh();assert.equal(a,b);await new Promise(setImmediate);assert.equal(t.requests.filter(r=>r.table==='rondas_marcaciones').length,1);pending.resolve({data:[row(1)]});await a;
});
test('renovar la sesión de la misma cuenta no vacía la caché ni reinicia el cursor',async()=>{
 const t=client();t.auth();t.control.rows=[row(1)];await t.refresh();const generation=t.run('cloudGeneration');t.auth();assert.equal(t.run('cloudReadings.length'),1);assert.equal(t.run('cloudGeneration'),generation);await t.refresh();assert.equal(t.requests.at(-1).cursor,1);
});
test('cambiar de cuenta elimina la caché y descarta respuestas tardías de la anterior',async()=>{
 const t=client(),pending=deferred();t.auth();t.control.read=()=>pending.promise;const loading=t.refresh();await new Promise(setImmediate);t.auth('other');pending.resolve({data:[row(1)]});await loading;assert.equal(t.run('cloudReadings.length'),0);assert.equal(t.run('cloudCursors.size'),0);
});
test('un fallo auxiliar no impide recibir lecturas; un fallo de lecturas conserva lo ya descargado',async()=>{
 const t=client();t.auth();t.control.rows=[row(1)];t.control.config=()=>Promise.reject(new Error('configuración no disponible'));await t.refresh();assert.equal(t.run('cloudReadings.length'),1);t.control.read=()=>({error:new Error('sin red')});await t.refresh();assert.equal(t.run('cloudReadings.length'),1);assert.equal(t.run("cloudCursors.get('b')"),1);
});
test('la paginación completa el historial inicial y luego continúa desde el último identificador',async()=>{
 const t=client();t.auth();t.control.rows=Array.from({length:1001},(_v,i)=>row(i+1));await t.refresh();await t.refresh();assert.equal(t.run('cloudReadings.length'),1001);assert.deepEqual(t.requests.filter(r=>r.table==='rondas_marcaciones').map(r=>r.cursor),[0,1000,1001]);
});
test('se eliminan las lecturas en memoria de edificios cuyo acceso fue retirado',async()=>{
 const t=client();t.auth();t.control.rows=[row(1)];await t.refresh();t.control.buildings=[];await t.refresh();assert.equal(t.run('cloudReadings.length'),0);assert.equal(t.run('cloudCursors.size'),0);
});
test('si se conserva el foco de un selector se difiere solo el dibujo, no la descarga',async()=>{
 const t=client();t.auth();t.control.rows=[row(1)];t.active.matches=()=>true;const before=t.renders;await t.refresh();assert.equal(t.run('cloudReadings.length'),1);assert.equal(t.renders,before);t.active.matches=()=>false;t.events.focusout();t.timers.at(-1)();assert.ok(t.renders>before);
});
test('navegar a calendario dibuja primero y consulta inmediatamente sin esperar un intervalo',()=>{
 const app=fs.readFileSync(path.join(__dirname,'../app.js'),'utf8'),calls=[],c=vm.createContext({location:{},setSidebarOpen(){},render:()=>calls.push('render'),refreshCloud:()=>calls.push('refresh')});vm.runInContext(app.slice(app.indexOf('function navigate('),app.indexOf('function modal(')),c);vm.runInContext("navigate('calendario')",c);assert.deepEqual(calls,['render','refresh']);assert.match(app,/hashchange[^\n]+refreshCloud\(\)/);
});
