const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../app.js'),'utf8');
function setup(logs=[]){
 const schedule={id:'m',buildingId:'building',type:'meters',rotationShift:'meters',employeeId:'jorge',employeeId2:'sandra',required:['p'],active:true};
 const state={buildings:[{id:'building',weeklyRotation:{from:'2026-11-23',morningEmployeeId:'sandra',afternoonEmployeeId:'jorge',workDays:[1,2,3,4,5,6]}}]};
 const c=vm.createContext({Date,Set,addDays:(date,n)=>{const d=new Date(date+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10)},state,logs,schedule,now:'2026-12-01T00:00:00',month:'2026-11',pad:n=>String(n).padStart(2,'0'),toDate:d=>new Date(d+'T12:00:00'),point:()=>({active:true,code:'A1'}),dtISO:()=>c.now,current:()=>logs,activeSchedules:()=>[schedule]});
 vm.runInContext(source.slice(source.indexOf('const dayType='),source.indexOf('const schedLabel=')),c);return {c,run:s=>vm.runInContext(s,c)};
}
test('el 23 Sandra pasa a mañana, el 30 Jorge, y se alternan lunes sin reiniciar al cambiar de mes o año',()=>{
 const t=setup();for(const [date,name]of [['2026-11-22','jorge'],['2026-11-23','sandra'],['2026-11-28','sandra'],['2026-11-30','jorge'],['2026-12-05','jorge'],['2026-12-07','sandra'],['2027-01-04','sandra']]){t.c.input={...t.c.schedule,rotationShift:'morning'};assert.equal(t.run(`resolveSchedule(input,'${date}').employeeId`),name,date)}
 t.c.input={...t.c.schedule,rotationShift:'afternoon',employeeId:'sandra',employeeId2:''};assert.equal(t.run("resolveSchedule(input,'2026-11-22').employeeId"),'sandra');assert.equal(t.run("resolveSchedule(input,'2026-11-23').employeeId"),'jorge');assert.equal(t.run("resolveSchedule(input,'2026-11-30').employeeId"),'sandra');
});
test('medidores cuenta una obligación por persona aunque el último lunes cambie de turno',()=>{
 const t=setup([{code:'A1',timestamp:'2026-11-27T10:00:00'}]);assert.equal(t.run('getEvaluations(month).length'),2);assert.equal(t.run("getEvaluations(month).find(e=>e.s.employeeId==='sandra').status"),'ok');assert.equal(t.run("getEvaluations(month).find(e=>e.s.employeeId==='jorge').status"),'missed');
 t.c.logs.push({code:'A1',timestamp:'2026-11-30T10:00:00'});assert.equal(t.run("getEvaluations(month).find(e=>e.s.employeeId==='jorge').status"),'ok');assert.equal(t.run("getEvaluations(month).find(e=>e.s.employeeId==='jorge').date"),'2026-11-30');assert.equal(t.run('getEvaluations(month).length'),2);
});
test('las 15:00 asignan la lectura al conserje de tarde de esa semana y domingo no acredita a esta pareja',()=>{
 const t=setup([{code:'A1',timestamp:'2026-11-27T15:00:00'},{code:'A1',timestamp:'2026-11-29T10:00:00'}]);assert.equal(t.run("getEvaluations(month).find(e=>e.s.employeeId==='jorge').status"),'ok');assert.equal(t.run("getEvaluations(month).find(e=>e.s.employeeId==='sandra').status"),'missed');
});
test('los responsables fijos y otros edificios no cambian',()=>{
 const t=setup();t.c.input={employeeId:'other',rotationShift:''};assert.equal(t.run("resolveSchedule(input,'2026-11-30').employeeId"),'other');t.c.input={employeeId:'other',rotationShift:'morning',buildingId:'another'};assert.equal(t.run("resolveSchedule(input,'2026-11-30').employeeId"),'other');
});
