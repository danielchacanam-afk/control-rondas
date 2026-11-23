const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
function client(){const c=vm.createContext({Date,Map,Set});vm.runInContext(fs.readFileSync(path.join(__dirname,'../report-export.js'),'utf8'),c);return {c,run:s=>vm.runInContext(s,c)}}
function round(overrides={}){return {date:'2026-11-19',s:{type:'weekday',turn:'Mañana',employeeId:'j',required:['p','q']},window:{start:'2026-11-19T10:00:00',end:'2026-11-19T10:30:00'},status:'incomplete',logs:[],...overrides}}
const point={id:'p',name:'Sala de Bombas',code:'A1',active:true};
test('verde usa una marca dentro del horario aunque exista una marca anterior tardía',()=>{
 const t=client();t.c.e=round({logs:[{timestamp:'2026-11-19T09:40:00',code:'a1'},{timestamp:'2026-11-19T10:10:00',code:'A1'}]});t.c.p=point;
 assert.equal(t.run("reportPointCell(e,p,'2026-11-23T12:00:00').value"),'10:10');assert.equal(t.run("reportPointCell(e,p,'2026-11-23T12:00:00').kind"),'inside');
});
test('morado incluye hora y Fuera de Horario; rojo identifica un punto sin marca',()=>{
 const t=client();t.c.e=round({logs:[{timestamp:'2026-11-19T11:40:00',code:'A1'}]});t.c.p=point;
 assert.equal(t.run("reportPointCell(e,p,'2026-11-23T12:00:00').value"),'11:40\nFuera de Horario');assert.equal(t.run("reportPointCell(e,p,'2026-11-23T12:00:00').kind"),'outside');
 t.c.e.logs=[];assert.equal(t.run("reportPointCell(e,p,'2026-11-23T12:00:00').kind"),'missing');
});
test('pendientes, puntos ajenos y configuración incompleta no se presentan como incumplimientos',()=>{
 const t=client();t.c.e=round({status:'pending'});t.c.p=point;
 assert.equal(t.run("reportPointCell(e,p,'2026-11-23T12:00:00').kind"),'pending');t.c.p={...point,id:'other'};assert.equal(t.run("reportPointCell(e,p,'2026-11-23T12:00:00').required"),0);t.c.p={...point,code:''};assert.equal(t.run("reportPointCell(e,p,'2026-11-23T12:00:00').kind"),'unconfigured');
});
test('cada hoja cuenta puntos únicos, respeta responsable resuelto y limita al mes actual hasta el instante de corte',()=>{
 const t=client();t.c.input={cutoff:'2026-11-23T12:00:00',building:{name:'Edificio'},employees:[{id:'j',name:'Jorge Bastías',active:true},{id:'s',name:'Sandra Daza',active:true}],points:[point,{id:'q',name:'Calderas',code:'B2',active:true}],evaluations:[round({logs:[{timestamp:'2026-11-19T10:10:00',code:'A1'},{timestamp:'2026-11-19T10:15:00',code:'A1'}]}),round({date:'2026-11-24'}),round({date:'2026-10-31'}),round({date:'2026-11-23',window:{start:'2026-11-24T02:00:00',end:'2026-11-24T02:30:00'}})]};
 assert.equal(t.run('buildPatrolReportData(input).sheets.length'),3);assert.equal(t.run('buildPatrolReportData(input).sheets[0].rows.length'),1);assert.equal(t.run('buildPatrolReportData(input).sheets[0].rows[0].marked'),1);assert.equal(t.run('buildPatrolReportData(input).sheets[0].rows[0].required'),2);assert.equal(t.run('buildPatrolReportData(input).sheets[1].rows.length'),0);assert.equal(t.run('buildPatrolReportData(input).from'),'2026-11-01');
});
test('una marca posterior al corte no se incluye aunque se reciba durante la generación',()=>{
 const t=client();t.c.e=round({logs:[{timestamp:'2026-11-19T10:20:00',code:'A1'}]});t.c.p=point;assert.equal(t.run("reportPointCell(e,p,'2026-11-19T10:10:00').marked"),0);
});
test('nombres de hojas válidos y únicos, incluyendo diferencias solo en mayúsculas',()=>{
 const t=client();t.run('globalThis.used=new Set()');const a=t.run("reportSheetName('Nombre/con:caracteres?*[]',used)");assert.ok(!/[\\/?*\[\]:]/.test(a));const first=t.run("reportSheetName('A'.repeat(40),used)"),second=t.run("reportSheetName('a'.repeat(40),used)");assert.equal(first.length,31);assert.ok(second.length<=31);assert.notEqual(first.toLowerCase(),second.toLowerCase());
});
test('cada conserje recibe solo sus puntos y agua caliente queda exclusivamente en una hoja aparte',()=>{
 const t=client();const normal=round({s:{type:'weekday',turn:'Mañana',employeeId:'j',required:['p']},logs:[{timestamp:'2026-11-19T10:10:00',code:'A1'}]});
 const meter=round({date:'2026-11-28',s:{type:'meters',turn:'Lectura de Medidores',employeeId:'j',required:['water']},window:{start:'2026-11-27T08:00:00',end:'2026-11-30T15:00:00'},status:'ok',logs:[{timestamp:'2026-11-28T10:00:00',code:'W1'}]});
 t.c.input={cutoff:'2026-11-30T12:00:00',building:{name:'Edificio'},employees:[{id:'j',name:'Jorge Bastías',active:true},{id:'s',name:'Sandra Daza',active:true}],points:[point,{id:'water',name:'A. Caliente 1',code:'W1',active:true},{id:'unused',name:'Otro punto',code:'X1',active:true}],evaluations:[normal,meter]};
 assert.equal(t.run("buildPatrolReportData(input).sheets[0].points.map(p=>p.id).join(',')"),'p');assert.equal(t.run('buildPatrolReportData(input).sheets[0].rows.length'),1);assert.equal(t.run('buildPatrolReportData(input).sheets[0].rows[0].required'),1);
 assert.equal(t.run("buildPatrolReportData(input).sheets.find(s=>s.kind==='water').points.map(p=>p.id).join(',')"),'water');assert.equal(t.run("buildPatrolReportData(input).sheets.find(s=>s.kind==='water').rows[0].responsible"),'Jorge Bastías');assert.equal(t.run("buildPatrolReportData(input).sheets.find(s=>s.kind==='water').rows[0].marked"),1);assert.ok(!t.run('JSON.stringify(buildPatrolReportData(input))').includes('No aplica'));
});
test('la hoja de agua caliente existe aun antes de comenzar la ventana mensual, sin inventar incumplimientos',()=>{
 const t=client();t.c.input={cutoff:'2026-11-23T12:00:00',building:{name:'Edificio'},employees:[{id:'j',name:'Jorge',active:true}],points:[point],evaluations:[round({date:'2026-11-30',s:{type:'meters',employeeId:'j',required:['p']},window:{start:'2026-11-27T08:00:00',end:'2026-11-30T15:00:00'},status:'pending'})]};assert.equal(t.run("buildPatrolReportData(input).sheets.find(s=>s.kind==='water').rows.length"),0);assert.equal(t.run("buildPatrolReportData(input).sheets.find(s=>s.kind==='water').points.length"),1);assert.equal(t.run('buildPatrolReportData(input).sheets[0].points.length'),0);
});
