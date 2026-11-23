const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../config-access.js'),'utf8');
function client(rpc=async()=>({data:{ok:true,permiso:'a'.repeat(64),vence_en:new Date(Date.now()+900000).toISOString()}})) {
 const handlers={}, nodes=new Map(), requests=[];
 const context=vm.createContext({Date,URL,Headers,Set,Promise,
  cloudUser:{id:'owner',email:'test@example.invalid'},route:'configuracion',state:{activeId:'brown-norte'},
  safe:String,header:(title,desc)=>title+desc,render(){},toast(){},navigate(){},configFlush:async()=>{},
  cloudClient:{rpc},fetch:(...args)=>{requests.push(args);return Promise.resolve({ok:true})},
  setTimeout(){},setInterval(){},FormData:class{constructor(form){this.values=form.values}get(key){return this.values[key]}},
  document:{getElementById(id){if(!nodes.has(id))nodes.set(id,{open:false,textContent:'',close(){this.open=false}});return nodes.get(id)},
   addEventListener(type,callback){handlers[type]=callback}},window:{addEventListener(){},matchMedia(){return {addEventListener(){}}}},
  localStorage:{setItem(){throw Error('No se debe guardar el permiso ni la clave en localStorage')}}
 });
 vm.runInContext(source,context);
 const run=code=>vm.runInContext(code,context);
 run("configurationIdentity='owner';configurationStatus={administrador:true,configurada:true}");
 function form(values){return{id:'configuration-access',values,querySelector:()=>({disabled:false}),reset(){this.wasReset=true}}}
 return {context,run,handlers,nodes,requests,form};
}
test('la pantalla cerrada pide clave y la primera creación exige confirmación',()=>{
 const c=client();assert.match(c.run('renderConfigurationGate()'),/Ingresa la clave/);
 c.run('configurationStatus.configurada=false');assert.match(c.run('renderConfigurationGate()'),/Repite la clave/);
 c.run('configurationIdentity=null');assert.match(c.run('renderConfigurationGate()'),/Inicia sesión/);
});
test('claves distintas no se envían al servidor',async()=>{
 let calls=0;const c=client(async()=>{calls++;return{}});c.run('configurationStatus.configurada=false');
 await c.handlers.submit({target:c.form({clave:'prueba-123',confirmacion:'otra-clave'}),preventDefault(){}});
 assert.equal(calls,0);assert.equal(c.nodes.get('configuration-access-error').textContent,'Las claves no coinciden');
});
test('desbloqueo válido habilita el acceso sin almacenar la clave ni el permiso',async()=>{
 const c=client();const form=c.form({clave:'clave-de-prueba'});
 await c.handlers.submit({target:form,preventDefault(){}});
 assert.equal(c.run('configurationCanWrite()'),true);assert.equal(form.wasReset,true);
 c.run('configurationDeadline=Date.now()-1');assert.equal(c.run('configurationCanWrite()'),false);
});
test('un resultado incorrecto del servidor nunca abre Configuración',async()=>{
 const c=client(async()=>({data:{ok:false,mensaje:'Clave incorrecta'}}));
 await c.handlers.submit({target:c.form({clave:'equivocada'}),preventDefault(){}});
 assert.equal(c.run('configurationCanWrite()'),false);
 assert.equal(c.nodes.get('configuration-access-error').textContent,'Clave incorrecta');
});
test('el permiso solo se adjunta a las escrituras del proyecto autorizado',async()=>{
 const c=client();c.run("configurationOpen=true;configurationToken='secreto-de-prueba';configurationDeadline=Date.now()+60000");
 await c.run("configurationFetch('https://mqzhxhvtfszjypwumizl.supabase.co/rest/v1/rpc/rondas_guardar_configuracion',{headers:{apikey:'publica'}})");
 assert.equal(c.requests[0][1].headers.get('x-rondas-configuracion'),'secreto-de-prueba');
 await c.run("configurationFetch('https://otro.example/rest/v1/rpc/rondas_guardar_configuracion',{headers:{apikey:'publica'}})");
 assert.equal(c.requests[1][1].headers['x-rondas-configuracion'],undefined);
 await c.run("configurationFetch('https://mqzhxhvtfszjypwumizl.supabase.co/rest/v1/rondas_marcaciones',{headers:{apikey:'publica'}})");
 assert.equal(c.requests[2][1].headers['x-rondas-configuracion'],undefined);
});
test('bloquear espera a las escrituras enviadas y revoca únicamente su permiso',async()=>{
 const calls=[];const c=client(async(name,args)=>{calls.push([name,args]);return{data:true}});
 let finish;c.context.fetch=()=>new Promise(resolve=>{finish=resolve});
 c.run("configurationOpen=true;configurationToken='permiso-viejo';configurationDeadline=Date.now()+60000");
 const request=c.run("configurationFetch('https://mqzhxhvtfszjypwumizl.supabase.co/rest/v1/rpc/rondas_guardar_configuracion')");
 const locking=c.run('configurationLock()');assert.equal(c.run('configurationCanWrite()'),false);assert.equal(calls.length,0);
 finish({ok:true});await request;await locking;
 assert.equal(calls[0][0],'rondas_bloquear_configuracion');assert.equal(calls[0][1].permiso,'permiso-viejo');
});
test('una respuesta de otra sesión no desbloquea la nueva cuenta',async()=>{
 let finish;const c=client(()=>new Promise(resolve=>{finish=resolve}));
 const submitting=c.handlers.submit({target:c.form({clave:'prueba-123'}),preventDefault(){}});
 c.run("configurationAccountChanged({id:'another-user'})");
 finish({data:{ok:true,permiso:'a'.repeat(64),vence_en:new Date(Date.now()+900000).toISOString()}});
 await submitting;assert.equal(c.run('configurationCanWrite()'),false);assert.equal(c.run('configurationToken'),'');
});
test('el enlace anterior de Conserjes pasa por la pantalla protegida',()=>{
 const nodes=new Map(),location={hash:'#conserjes'};
 const document={querySelectorAll:()=>[],addEventListener(){},getElementById(id){if(!nodes.has(id))nodes.set(id,{classList:{remove(){}},innerHTML:'',textContent:''});return nodes.get(id)}};
 const context=vm.createContext({document,window:{addEventListener(){},matchMedia(){return {addEventListener(){}}}},location,history:{replaceState(_a,_b,url){location.hash=url}},
  localStorage:{getItem:()=>null},configurationCanWrite:()=>false,renderConfigurationGate:()=>'<p>Pantalla protegida</p>',configurationRouteChanged(){},
  Date,Intl,Math,Map,Set});
 vm.runInContext(fs.readFileSync(path.join(__dirname,'../app.js'),'utf8'),context);
 assert.equal(vm.runInContext('route',context),'configuracion');assert.equal(vm.runInContext('tab',context),'conserjes');
 assert.equal(nodes.get('app').innerHTML,'<p>Pantalla protegida</p>');
 const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');assert.doesNotMatch(html,/data-route="conserjes"/);
});
