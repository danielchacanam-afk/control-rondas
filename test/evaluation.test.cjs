const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../app.js'),'utf8');
function setup(readings=[],schedules){
 const required=Array.from({length:7},(_,i)=>'P'+i);
 const base={type:'weekday',offset:0,required,employeeId:'person',active:true};
 const c=vm.createContext({Date,Map,Set,month:'2026-11',now:'2026-11-22T12:00:00',readings,schedules:schedules||[{...base,id:'am',start:'10:00',end:'10:30'},{...base,id:'pm',start:'20:00',end:'20:30'},{...base,id:'n1',start:'02:00',end:'02:30',offset:1},{...base,id:'n2',start:'05:00',end:'05:30',offset:1}],pad:n=>String(n).padStart(2,'0'),toDate:d=>new Date(d+'T12:00:00'),addDays:(date,n)=>{const d=new Date(date+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10)},point:id=>({id,code:id,active:true}),dtISO:()=>c.now,current:()=>c.readings,activeSchedules:()=>c.schedules});
 vm.runInContext(source.slice(source.indexOf('const dayType='),source.indexOf('const schedLabel=')),c);
 return {c,run:s=>vm.runInContext(s,c),result:(date,id)=>vm.runInContext(`getEvaluations(month).find(e=>e.date==='${date}'&&e.s.id==='${id}')`,c)};
}
const log=(timestamp,code='P0')=>({timestamp,code,device:'reader'});
test('las jornadas importadas delimitan las marcas fuera de horario sin alterar la ventana explícita',()=>{
 const base={id:'custom',type:'weekday',offset:0,required:['P0'],employeeId:'person',active:true,start:'09:00',end:'09:30',shiftStart:'07:00',shiftEnd:'15:00',shiftEndOffset:0};
 const t=setup([log('2026-11-19T07:15:00')],[base]);assert.equal(t.result('2026-11-19','custom').count,1);
 t.c.schedules=[{...base,start:'04:45',end:'05:45',offset:1,shiftStart:'21:00',shiftEnd:'06:00',shiftEndOffset:1}];t.c.readings=[log('2026-11-20T06:30:00')];assert.equal(t.result('2026-11-19','custom').count,0);
 t.c.schedules=[{...base,start:'20:15',end:'21:15',shiftStart:'15:00',shiftEnd:'21:00'}];t.c.readings=[log('2026-11-19T21:10:00')];assert.equal(t.result('2026-11-19','custom').count,1);
});
test('un punto tardío produce incompleta fuera de horario y no afecta días vecinos ni tarde',()=>{
 const t=setup([log('2026-11-19T11:40:00')]);const e=t.result('2026-11-19','am');assert.equal(e.status,'incomplete');assert.equal(e.count,1);assert.equal(e.timing,'outside');assert.equal(e.missing.length,6);
 for(const [d,id]of [['2026-11-18','am'],['2026-11-20','am'],['2026-11-19','pm'],['2026-11-17','n1']])assert.equal(t.result(d,id).status,'missed');
});
test('siete puntos antes de la primera ronda nocturna completan solo esa ronda',()=>{
 const t=setup(Array.from({length:7},(_,i)=>log('2026-11-20T01:4'+(i%2)+':00','P'+i)));const e=t.result('2026-11-19','n1');assert.equal(e.status,'outside');assert.equal(e.count,7);assert.equal(e.timing,'outside');assert.equal(t.result('2026-11-19','n2').status,'missed');assert.equal(t.result('2026-11-20','am').status,'missed');assert.equal(t.run('getEvaluations(month).reduce((n,e)=>n+(e.logs?.length||0),0)'),7);
});
test('repetir el mismo punto no completa los siete puntos obligatorios',()=>{
 const t=setup([log('2026-11-19T10:05:00'),log('2026-11-19T10:06:00')]);assert.equal(t.result('2026-11-19','am').count,1);assert.equal(t.result('2026-11-19','am').status,'incomplete');assert.equal(t.result('2026-11-19','am').timing,'inside');
});
test('una lectura en otro turno o a más de dos horas no se asocia',()=>{
 const t=setup([log('2026-11-19T14:00:00'),log('2026-11-19T16:57:00'),log('2026-11-19T17:56:00')]);assert.equal(t.result('2026-11-19','am').count,0);assert.equal(t.result('2026-11-19','pm').count,0);
});
test('el límite de dos horas admite exactamente el extremo',()=>{
 const t=setup([log('2026-11-19T12:30:00'),log('2026-11-19T12:30:01','P1')]);assert.equal(t.result('2026-11-19','am').count,1);
});
test('las lecturas dentro del horario completan la ronda y no se degradan por una repetición tardía',()=>{
 const t=setup([...Array.from({length:7},(_,i)=>log('2026-11-19T10:10:00','P'+i)),log('2026-11-19T11:00:00')]);assert.equal(t.result('2026-11-19','am').status,'ok');assert.equal(t.result('2026-11-19','am').timing,'inside');
});
test('las rondas pendientes muestran avances y las lecturas futuras no cuentan',()=>{
 const t=setup([log('2026-11-19T10:05:00'),log('2026-11-19T10:25:00','P1')]);t.c.now='2026-11-19T10:15:00';assert.equal(t.result('2026-11-19','am').status,'pending');assert.equal(t.result('2026-11-19','am').count,1);
});
test('una marca en ventanas superpuestas se asigna una sola vez, sin depender del orden',()=>{
 const t=setup([log('2026-11-19T10:10:00')]);t.c.schedules=[t.c.schedules[0],{...t.c.schedules[0],id:'am2'}];const a=t.run("getEvaluations(month).filter(e=>e.date==='2026-11-19').map(e=>[e.s.id,e.count]).sort()");assert.equal(a.reduce((n,e)=>n+e[1],0),1);t.c.schedules.reverse();const b=t.run("getEvaluations(month).filter(e=>e.date==='2026-11-19').map(e=>[e.s.id,e.count]).sort()");assert.equal(JSON.stringify(a),JSON.stringify(b));
});
test('los bordes de mes consideran rondas del mes vecino sin reutilizar lecturas',()=>{
 const t=setup([log('2026-12-01T01:40:00')]);t.c.now='2026-12-02T00:00:00';assert.equal(t.result('2026-11-30','n1').count,1);t.c.month='2026-12';assert.equal(t.run('getEvaluations(month).reduce((n,e)=>n+e.count,0)'),0);
});
