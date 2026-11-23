const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../app.js'),'utf8');
function setup(month,now,logs=[],required=['p']){
 const schedule={id:'monthly',type:'meters',required,active:true,start:'10:00',end:'11:00',offset:1};
 const c=vm.createContext({Date,Set,month,now,logs,schedule,
 pad:n=>String(n).padStart(2,'0'),toDate:s=>new Date(s+'T12:00:00'),dtISO:()=>c.now,
 point:id=>id==='p'?{id,active:true,code:'A1'}:id==='q'?{id,active:true,code:'B2'}:null,
 current:()=>logs,activeSchedules:()=>[schedule]});
 vm.runInContext(source.slice(source.indexOf('const dayType='),source.indexOf('const schedLabel=')),c);
 return {run:s=>vm.runInContext(s,c),c};
}
test('ventana mensual usa los últimos cuatro días, incluidos febrero y año bisiesto',()=>{
 for(const [month,start,end] of [['2026-11','27','30'],['2026-12','28','31'],['2026-02','25','28'],['2028-02','26','29']]){
 const t=setup(month,month+'-01T00:00:00');assert.equal(t.run('meterWindow(month).start'),month+'-'+start+'T00:00:00');assert.equal(t.run('meterWindow(month).end'),month+'-'+end+'T23:59:59');
 }
});
test('una lectura el 28 cumple inmediatamente y genera un único resultado mensual',()=>{
 const t=setup('2026-11','2026-11-28T12:00:00',[{code:'a1',timestamp:'2026-11-28T11:00:00'},{code:'A1',timestamp:'2026-11-29T11:00:00'}]);
 assert.equal(t.run('getEvaluations(month).length'),1);assert.equal(t.run('getEvaluations(month)[0].status'),'ok');assert.equal(t.run('getEvaluations(month)[0].date'),'2026-11-28');
});
test('sin lectura queda una sola pendiente hasta vencer; fuera de ventana no cumple',()=>{
 const logs=[{code:'A1',timestamp:'2026-11-26T23:59:59'},{code:'A1',timestamp:'2026-12-01T00:00:00'}];
 const t=setup('2026-11','2026-11-30T14:59:59',logs);assert.equal(t.run('getEvaluations(month)[0].status'),'pending');assert.equal(t.run('getEvaluations(month)[0].date'),'2026-11-30');
 t.c.now='2026-12-01T00:00:00';assert.equal(t.run('getEvaluations(month)[0].status'),'missed');
});
test('cuenta ambos extremos del período y no cuenta lecturas futuras ni de otro código',()=>{
 for(const timestamp of ['2026-11-27T08:00:00','2026-11-30T14:59:59'])assert.equal(setup('2026-11','2026-12-01T00:00:00',[{code:'A1',timestamp}]).run('getEvaluations(month)[0].status'),'ok');
 assert.equal(setup('2026-11','2026-11-28T10:00:00',[{code:'A1',timestamp:'2026-11-28T11:00:00'},{code:'other',timestamp:'2026-11-27T00:00:00'}]).run('getEvaluations(month)[0].count'),0);
});
test('todos los puntos obligatorios deben completarse; incompleta solo al vencer',()=>{
 const t=setup('2026-11','2026-11-28T12:00:00',[{code:'A1',timestamp:'2026-11-28T11:00:00'}],['p','q']);assert.equal(t.run('getEvaluations(month)[0].status'),'pending');t.c.now='2026-12-01T00:00:00';assert.equal(t.run('getEvaluations(month)[0].status'),'incomplete');t.c.logs.push({code:'B2',timestamp:'2026-11-29T11:00:00'});assert.equal(t.run('getEvaluations(month)[0].status'),'ok');assert.equal(t.run('getEvaluations(month)[0].date'),'2026-11-29');
});
test('un punto sin configurar no se informa como no realizado',()=>{
 assert.equal(setup('2026-11','2026-12-01T00:00:00',[],['unknown']).run('getEvaluations(month)[0].status'),'unconfigured');
});
test('mañana cumplida no completa tarde; cada responsable conserva su propio estado',()=>{
 const t=setup('2026-11','2026-11-28T18:00:00',[{code:'A1',timestamp:'2026-11-28T09:00:00'}]);
 Object.assign(t.c.schedule,{employeeId:'one',employeeId2:'two',meterTimed:true,start:'08:00',end:'11:59',start2:'12:00',end2:'20:00'});
 assert.equal(t.run('getEvaluations(month).length'),2);
 assert.equal(t.run('getEvaluations(month)[0].s.employeeId'),'one');assert.equal(t.run('getEvaluations(month)[0].status'),'ok');assert.equal(t.run('getEvaluations(month)[0].date'),'2026-11-28');
 assert.equal(t.run('getEvaluations(month)[1].s.employeeId'),'two');assert.equal(t.run('getEvaluations(month)[1].status'),'pending');
 t.c.now='2026-12-01T00:00:00';assert.equal(t.run('getEvaluations(month)[1].status'),'missed');assert.equal(t.run('getEvaluations(month)[0].status'),'ok');
 t.c.logs.push({code:'A1',timestamp:'2026-11-29T16:00:00'});assert.equal(t.run('getEvaluations(month)[1].status'),'ok');assert.equal(t.run('getEvaluations(month)[1].date'),'2026-11-29');assert.equal(t.run('getEvaluations(month).length'),2);
});
test('las marcas de las 15:00 pertenecen únicamente al turno de tarde y fuera de ambos no cumplen',()=>{
 const t=setup('2026-11','2026-12-01T00:00:00',[{code:'A1',timestamp:'2026-11-28T15:00:00'},{code:'A1',timestamp:'2026-11-28T07:59:59'}]);
 Object.assign(t.c.schedule,{employeeId:'one',employeeId2:'two',meterTimed:true,start:'08:00',end:'11:59',start2:'12:00',end2:'20:00'});
 assert.equal(t.run('getEvaluations(month)[0].status'),'missed');assert.equal(t.run('getEvaluations(month)[1].status'),'ok');
});
test('un conserje con horario propio tampoco recibe marcas fuera de su turno',()=>{
 const t=setup('2026-11','2026-12-01T00:00:00',[{code:'A1',timestamp:'2026-11-28T16:00:00'}]);Object.assign(t.c.schedule,{employeeId:'one',meterTimed:true,start:'08:00',end:'11:59'});
 assert.equal(t.run('getEvaluations(month).length'),1);assert.equal(t.run('getEvaluations(month)[0].status'),'missed');
});

test('horarios fijos ignoran los valores antiguos y respetan los límites de las 08, 15 y 22',()=>{
 for(const [time,morning,afternoon] of [['07:59:59','missed','missed'],['08:00:00','ok','missed'],['14:59:59','ok','missed'],['15:00:00','missed','ok'],['22:00:00','missed','ok'],['22:00:01','missed','missed']]){
  const t=setup('2026-11','2026-12-01T00:00:00',[{code:'A1',timestamp:'2026-11-28T'+time}]);Object.assign(t.c.schedule,{employeeId:'one',employeeId2:'two',start:'00:00',end:'23:59',start2:'00:00',end2:'23:59'});
  assert.equal(t.run('getEvaluations(month)[0].status'),morning,time);assert.equal(t.run('getEvaluations(month)[1].status'),afternoon,time);
 }
});
