'use strict';
/* Control de Rondas: configuración compartida y auxiliar USB independiente. */
const KEY='control-rondas-gh-v1';
const pointNames=['Sala de Bombas','Grupo Electrógeno','Estacionamiento de Visitas 1','Estacionamiento de Visitas 2','Sala de Basura 1','Sala de Basura 2','Sala de Calderas','A. Caliente 1 - O','A. Caliente 1 - P','A. Caliente 2 - O','A. Caliente 2 - P','A. Caliente 3 - O','A. Caliente 3 - P','A. Caliente 4 - O','A. Caliente 4 - P','A. Caliente 5 - O','A. Caliente 5 - P'];
const weekdays=['Domingo','Lunes','Martes','Miércoles','Jueves','Viernes','Sábado'];
const statusLabels={ok:'Cumplida',incomplete:'Incompleta',outside:'Completa fuera de horario',missed:'No realizada',pending:'Pendiente',unconfigured:'Sin configurar'};
const statusCSS={ok:'ok',incomplete:'maybe',outside:'off',missed:'bad',pending:'pending',unconfigured:'pending'};
const safe=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const id=()=>Math.random().toString(36).slice(2,10)+Date.now().toString(36);
const pad=x=>String(x).padStart(2,'0');
const dateISO=(d)=>`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
const dtISO=(d)=>`${dateISO(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
const toDate=(s)=>new Date(s+'T12:00:00');
const addDays=(ymd,n)=>{let d=toDate(ymd);d.setDate(d.getDate()+n);return dateISO(d)};
const fmtDate=s=>{const m=String(s||'').match(/^(\d{4})-(\d{2})-(\d{2})/);return m?`${m[3]}/${m[2]}/${m[1]}`:s};
const fmtDT=s=>s?`${fmtDate(s)} ${String(s).slice(11,16)}`:'';
const dateParts=()=>({today:dateISO(new Date()),month:dateISO(new Date()).slice(0,7)});
function createBase(){
 const points=pointNames.map(name=>({id:id(),name,code:'',active:true}));
 const schedules=[];
 for(const type of ['weekday','saturday','sunday']){
  const day=type==='sunday';const first=type==='weekday'?'10:00':'10:15';
  const windows=[[first,'11:15',0,day?'Día domingo':'Mañana'],[day?'16:45':'20:15',day?'17:45':'21:15',0,day?'Día domingo':'Tarde'],['02:45','03:45',1,'Noche'],['04:45','05:45',1,'Noche']];
  for(const [start,end,offset,turn] of windows)schedules.push({id:id(),buildingId:'brown-norte',type,start,end,offset,turn,employeeId:'',active:true,required:points.map(p=>p.id)});
 }
 return {version:1,activeId:'brown-norte',buildings:[{id:'brown-norte',name:'Brown Norte',demo:false}],points:points.map(p=>({...p,buildingId:'brown-norte'})),employees:[],schedules,devices:[{id:id(),buildingId:'brown-norte',serial:'5561',model:'JWM 5000V1',active:true}],readings:[],history:[]};
}
let state;try{state=JSON.parse(localStorage.getItem(KEY));if(!state||state.version!==1)state=createBase()}catch(_){state=createBase()}
const save=()=>{if(typeof persistCloudState==='function'&&persistCloudState())return;localStorage.setItem(KEY,JSON.stringify(state))};
let route='inicio',tab='rondas',filterDate=dateParts().month,calendarEmployee='',readFilter='',search='',viewDay='',refDate=new Date();
const bld=()=>state.buildings.find(b=>b.id===state.activeId)||state.buildings[0];
let cloudReadings = [];
const current = type => {
  if (type !== 'readings') return state[type].filter(item => item.buildingId === state.activeId);
  const unique = new Map();
  for (const item of [...state.readings, ...cloudReadings]) {
    if (item.buildingId !== state.activeId) continue;
    unique.set([item.device, item.timestamp, item.code].join('|'), item);
  }
  return [...unique.values()];
};
const point=(pid)=>state.points.find(p=>p.id===pid);
const employee=(eid)=>state.employees.find(e=>e.id===eid);
const dev=(serial)=>current('devices').find(d=>d.serial===serial);
const activePoints=()=>current('points').filter(p=>p.active);
const activeSchedules=()=>current('schedules').filter(s=>s.active);
const belongs=(r)=>r.buildingId===state.activeId;
function toast(message){const t=document.getElementById('toast');t.textContent=message;t.className='show';clearTimeout(window._toastTimer);window._toastTimer=setTimeout(()=>t.className='',4200)}
function badge(st){return `<span class="chip ${statusCSS[st]||'pending'}">${safe(statusLabels[st]||st)}</span>`}
const dayType=(date)=>{const d=toDate(date).getDay();return d===0?'sunday':d===6?'saturday':'weekday'};
const dayTitle={weekday:'Lunes a viernes',mondaySaturday:'Lunes a sábado',mondayThursday:'Lunes a jueves',fridaySunday:'Viernes a domingo',saturday:'Sábado',sunday:'Domingo',meters:'Lectura de Medidores'};
const scheduleApplies=(type,date)=>{
 const day=toDate(date).getDay();
 if(type==='mondaySaturday')return day>=1&&day<=6;
 if(type==='mondayThursday')return day>=1&&day<=4;
 if(type==='fridaySunday')return day===0||day>=5;
 return type===dayType(date);
};
function rotationRule(s){
 if(!s.rotationShift||typeof state==='undefined')return null;
 const rule=state.buildings.find(b=>b.id===s.buildingId)?.weeklyRotation;
 return rule&&rule.from&&rule.morningEmployeeId&&rule.afternoonEmployeeId?rule:null;
}
function rotationEmployee(s,date,shift){
 const rule=rotationRule(s);
 if(!rule||date<rule.from){if(s.meterRotating)return shift==='afternoon'?s.meterBaseEmployeeId2:s.meterBaseEmployeeId;return s.rotationShift==='meters'&&shift==='afternoon'?(s.employeeId2||s.employeeId):s.employeeId;}
 const days=(Date.parse(date+'T00:00:00Z')-Date.parse(rule.from+'T00:00:00Z'))/86400000;
 const alternate=Math.floor(days/7)%2===1;
 return (shift==='morning')!==alternate?rule.morningEmployeeId:rule.afternoonEmployeeId;
}
function resolveSchedule(s,date){
 if(!['morning','afternoon'].includes(s.rotationShift))return s;
 return {...s,employeeId:rotationEmployee(s,date,s.rotationShift)};
}
function rotationLabel(s){const rule=rotationRule(s);if(!rule)return employee(s.employeeId)?.name||'Por asignar';const date=dateParts().today;return (employee(rotationEmployee(s,date,s.rotationShift))?.name||'Por asignar')+' · Rotación semanal'}
function meterWindow(month){
 const [year,monthNumber]=month.split('-').map(Number),last=new Date(year,monthNumber,0).getDate();
 return {start:month+'-'+pad(last-3)+'T00:00:00',end:month+'-'+pad(last)+'T23:59:59'};
}
function meterAssignments(s,month){
 const rule=rotationRule(s);
 if(rule&&s.rotationShift==='meters'&&month&&meterWindow(month).end.slice(0,10)>=rule.from){
  return [rule.morningEmployeeId,rule.afternoonEmployeeId].map(employeeId=>({...s,meterBaseEmployeeId:s.employeeId,meterBaseEmployeeId2:s.employeeId2,employeeId,meterRotating:true,meterTimed:false,turn:'Lectura de Medidores · Rotación semanal'}));
 }

 const morning={...s,turn:'Lectura de Medidores · Mañana',start:'08:00',end:'15:00',meterTimed:true,endExclusive:true};
 if(!s.employeeId2)return [morning];
 return [morning,{...s,turn:'Lectura de Medidores · Tarde',employeeId:s.employeeId2,start:'15:00',end:'22:00',meterTimed:true,endExclusive:false}];
}
function meterResponsible(s){const rule=rotationRule(s);if(rule&&s.rotationShift==='meters')return (employee(rule.morningEmployeeId)?.name||'Por asignar')+' / '+(employee(rule.afternoonEmployeeId)?.name||'Por asignar')+' · Rotación semanal';return meterAssignments(s).map(a=>(employee(a.employeeId)?.name||'Por asignar')+(a.meterTimed?' ('+a.start+'–'+a.end+')':'')).join(' / ')}
function meterReadingOwner(s,timestamp){
 const time=timestamp.slice(11,19),date=timestamp.slice(0,10),rule=rotationRule(s);
 if(rule&&date>=rule.from&&!(rule.workDays||[1,2,3,4,5,6]).includes(toDate(date).getDay()))return null;
 if(time>='08:00:00'&&time<'15:00:00')return rotationEmployee(s,date,'morning');
 if(time>='15:00:00'&&time<='22:00:00')return rotationEmployee(s,date,'afternoon');
 return null;
}
function evaluateMeters(month,s,now=dtISO(new Date()),readings=current('readings')){
 const w=meterWindow(month);if(s.meterTimed){w.start=w.start.slice(0,10)+'T'+s.start+':00';w.end=w.end.slice(0,10)+'T'+s.end+':00'}const expected=s.required.map(point),valid=expected.length>0&&expected.every(p=>p&&p.active&&p.code.trim()!=='');
 const result={date:w.end.slice(0,10),window:w,s,status:'unconfigured',count:0,total:expected.length,visits:[],logs:[],missing:expected.filter(Boolean)};
 if(!valid)return result;
 const logs=readings.filter(r=>r.timestamp>=w.start&&r.timestamp<=w.end&&r.timestamp<=now&&(!s.meterRotating||meterReadingOwner(s,r.timestamp)===s.employeeId)&&(!s.meterTimed||(r.timestamp.slice(11,19)>=s.start+':00'&&(s.endExclusive?r.timestamp.slice(11,19)<s.end+':00':r.timestamp.slice(11,19)<=s.end+':00')))).slice().sort((a,b)=>a.timestamp.localeCompare(b.timestamp));
 const codes=new Set();let completed='';
 for(const log of logs){if(!expected.some(p=>p.code.toUpperCase()===String(log.code).toUpperCase()))continue;result.logs.push(log);codes.add(String(log.code).toUpperCase());if(expected.every(p=>codes.has(p.code.toUpperCase()))){completed=log.timestamp.slice(0,10);break}}
 result.visits=expected.filter(p=>codes.has(p.code.toUpperCase()));result.count=result.visits.length;result.missing=expected.filter(p=>!codes.has(p.code.toUpperCase()));
 if(completed){result.date=completed;result.status='ok'}else result.status=(s.endExclusive?now<w.end:now<=w.end)?'pending':result.count?'incomplete':'missed';
 return result;
}
const getWindow=(date,s)=>{
 const st=addDays(date,s.offset||0)+'T'+s.start+':00';
 let en=addDays(date,s.offset||0)+'T'+s.end+':00';
 if(en<st)en=addDays(date,(s.offset||0)+1)+'T'+s.end+':00';
 return {start:st,end:en};
};
const OUTSIDE_ROUND_MINUTES=120;
const readingKey=r=>[r.device||'',r.timestamp,String(r.code).toUpperCase()].join('|');
function shiftKey(timestamp){
 const date=timestamp.slice(0,10),time=timestamp.slice(11,19);
 if(time>='08:00:00'&&time<'15:00:00')return date+' morning';
 if(time>='15:00:00'&&time<='22:00:00')return date+' afternoon';
 return (time<'08:00:00'?addDays(date,-1):date)+' night';
}
function dailyOccurrence(date,s){
 s=resolveSchedule(s,addDays(date,s.offset||0));const window=getWindow(date,s),expected=s.required.map(point);
 return {date,s,window,expected,valid:expected.length>0&&expected.every(p=>p&&p.active&&p.code.trim()!==''),logs:[]};
}
function dailyOccurrences(from,to){
 const occurrences=[];
 for(let date=from;date<=to;date=addDays(date,1))for(const s of activeSchedules().filter(s=>s.type!=='meters'&&scheduleApplies(s.type,date)))occurrences.push(dailyOccurrence(date,s));
 return occurrences;
}
function assignDailyReadings(occurrences,readings,now){
 const consumed=new Set();
 for(const r of readings){
  if(r.timestamp>now||consumed.has(readingKey(r)))continue;
  const code=String(r.code).toUpperCase(),time=Date.parse(r.timestamp+'Z');let best=null,bestScore=null;
  for(const o of occurrences){
   if(!o.valid||!o.expected.some(p=>p.code.toUpperCase()===code))continue;
   const inside=r.timestamp>=o.window.start&&r.timestamp<=o.window.end;
   const distance=inside?0:Math.min(Math.abs(time-Date.parse(o.window.start+'Z')),Math.abs(time-Date.parse(o.window.end+'Z')));
   if(!inside&&(shiftKey(r.timestamp)!==shiftKey(o.window.start)||distance>OUTSIDE_ROUND_MINUTES*60000))continue;
   const score=[distance,Math.abs(time-(Date.parse(o.window.start+'Z')+Date.parse(o.window.end+'Z'))/2),o.window.start+'|'+o.s.id];
   if(!bestScore||score[0]<bestScore[0]||(score[0]===bestScore[0]&&(score[1]<bestScore[1]||(score[1]===bestScore[1]&&score[2]<bestScore[2])))){best=o;bestScore=score}
  }
  if(best){best.logs.push(r);consumed.add(readingKey(r))}
 }
 return consumed;
}
function evaluateOccurrence(o,now){
 const {date,s,window:w,expected,logs}=o,total=expected.length;
 if(!o.valid)return {date,s,window:w,status:'unconfigured',count:0,total,visits:[],logs:[],missing:expected.filter(Boolean),timing:'none'};
 const codes=new Set(logs.map(r=>String(r.code).toUpperCase())),timelyCodes=new Set(logs.filter(r=>r.timestamp>=w.start&&r.timestamp<=w.end).map(r=>String(r.code).toUpperCase()));
 const visits=expected.filter(p=>codes.has(p.code.toUpperCase())),missing=expected.filter(p=>!codes.has(p.code.toUpperCase()));
 const complete=visits.length===total,allTimely=expected.every(p=>timelyCodes.has(p.code.toUpperCase()));
 const status=complete?(allTimely?'ok':'outside'):now<w.end?'pending':visits.length?'incomplete':'missed';
 const timing=!visits.length?'none':(complete?allTimely:logs.every(r=>r.timestamp>=w.start&&r.timestamp<=w.end))?'inside':'outside';
 return {date,s,window:w,status,count:visits.length,total,visits,missing,logs,timing,completeness:complete?'complete':visits.length?'incomplete':'none'};
}
function evaluate(date,s,now=dtISO(new Date())){
 const occurrences=dailyOccurrences(addDays(date,-2),addDays(date,2));let target=occurrences.find(o=>o.date===date&&o.s.id===s.id);
 if(!target){target=dailyOccurrence(date,s);occurrences.push(target)}
 assignDailyReadings(occurrences,current('readings'),now);return evaluateOccurrence(target,now);
}
function getEvaluations(month){
 const [y,m]=month.split('-').map(Number),last=month+'-'+pad(new Date(y,m,0).getDate()),now=dtISO(new Date()),readings=current('readings');
 const occurrences=dailyOccurrences(addDays(month+'-01',-2),addDays(last,2)),consumed=assignDailyReadings(occurrences,readings,now);
 const monthly=[];let remaining=readings.filter(r=>!consumed.has(readingKey(r)));
 for(const s of activeSchedules().filter(s=>s.type==='meters'))for(const assignment of meterAssignments(s,month)){
  const result=evaluateMeters(month,assignment,now,remaining);monthly.push(result);
  const used=new Set((result.logs||[]).map(readingKey));remaining=remaining.filter(r=>!used.has(readingKey(r)));
 }
 return [...monthly,...occurrences.filter(o=>o.date.startsWith(month)).map(o=>evaluateOccurrence(o,now))];
}
function evaluationLabel(e){return e.status==='outside'?'Completa · Fuera de horario':statusLabels[e.status]}
function timingLabel(e){return e.timing==='outside'?'Fuera de horario':e.timing==='inside'||(e.count>0&&!e.timing)?'Dentro de horario':'Sin registros'}
function evaluationBadge(e){
 const complete=e.status==='ok'||e.status==='outside';
 return (complete?'<span class="chip ok">Completa</span>':badge(e.status))+((e.status==='outside'||e.timing==='outside')?'<span class="chip off">Fuera de horario</span>':'')+(e.status!=='unconfigured'?'<span class="round-progress">'+e.count+'/'+e.total+'</span>':'');
}

const schedLabel=s=>s.type==='meters'?'Lectura de Medidores · Una vez en los últimos 4 días del mes':`${dayTitle[s.type]} · ${s.turn} · ${s.start}–${s.end}${s.offset?' (+1 día)':''}`;
function toolbar(){const sel=document.getElementById('building-picker');sel.innerHTML=state.buildings.map(b=>`<option value="${safe(b.id)}" ${b.id===state.activeId?'selected':''}>${safe(b.name)}${b.demo?' (DEMO)':''}</option>`).join('');document.getElementById('today-label').textContent=new Intl.DateTimeFormat('es-CL',{day:'2-digit',month:'short',year:'numeric'}).format(new Date());document.querySelectorAll('[data-route]').forEach(a=>a.classList.toggle('active',a.dataset.route===route));document.getElementById('breadcrumb').textContent=({inicio:'Panel general',lecturas:'Registros de lecturas',calendario:'Calendario mensual',conserjes:'Personal',configuracion:'Administración',sincronizacion:'Integraciones',informes:'Reportes'}[route]||'Panel general');}
function header(title,description,actions='',eyebrow='CONTROL Y SUPERVISIÓN'){return `<div class="page-head"><div><div class="eyebrow">${eyebrow}</div><h1>${safe(title)}</h1><p class="desc">${description}</p></div><div class="actions">${actions}</div></div>`}
function banner(){return `<div class="banner"><strong>Versión de desarrollo.</strong> ${typeof renderCloudNotice==='function'?renderCloudNotice():'Abre Sincronización para iniciar sesión y consultar las lecturas compartidas.'} ${bld().demo?'<strong> Edificio de demostración: los datos son ficticios.</strong>':''}</div>`}
function countRows(evals){return Object.fromEntries(['ok','incomplete','outside','missed','pending','unconfigured'].map(s=>[s,evals.filter(x=>x.status===s).length]))}
function panelTable(headers,rows){return `<div class="table-scroll"><table><thead><tr>${headers.map(h=>`<th>${safe(h)}</th>`).join('')}</tr></thead><tbody>${rows||`<tr><td colspan="${headers.length}" class="empty">No hay registros para mostrar.</td></tr>`}</tbody></table></div>`}
function renderHome(){const ev=getEvaluations(filterDate),c=countRows(ev),evaluables=c.ok+c.incomplete+c.outside+c.missed;const rate=evaluables?Math.round(100*c.ok/evaluables):null;
 const latest=current('readings').slice().sort((a,b)=>b.timestamp.localeCompare(a.timestamp)).slice(0,8);
 const rows=latest.map(r=>`<tr><td>${fmtDT(r.timestamp)}</td><td class="value-strong">${safe(nameByCode(r.code))}</td><td>${safe(r.device)}</td><td>${r.demo?'<span class="chip demo">DEMO</span>':'<span class="chip pending">Importada</span>'}</td></tr>`).join('');
 return header(`Rondas · ${bld().name}`,'Supervisa el cumplimiento de recorridos y consulta las lecturas por período.',`<input aria-label="Mes de evaluación" type="month" id="month-filter" value="${filterDate}"><button class="btn" data-action="demo">${bld().demo?"Ver DEMO":"Cargar DEMO"}</button><button class="btn primary" data-route-action="informes">Ver informes</button>`)+banner()+
 `<div class="grid stats">${[[String(ev.length),'Rondas programadas','Para el mes'],[String(c.ok),'Cumplidas','Dentro de horario'],[String(c.incomplete+c.outside+c.missed),'Incidencias','Evaluables y vencidas'],[rate===null?'—':rate+'%','Cumplimiento','Pendientes excluidas']].map(([v,l,d])=>`<div class="panel stat"><small>${l}</small><strong>${v}</strong><span class="detail">${d}</span></div>`).join('')}</div>`+
 `<div class="grid two-col"><section class="panel"><div class="panel-head"><div><h2>Últimas lecturas</h2><p class="subhead">Marcaciones disponibles del edificio</p></div><button class="btn small" data-route-action="lecturas">Ver todas</button></div>${panelTable(['Fecha y hora','Punto','Lector','Origen'],rows)}</section><section class="panel"><div class="panel-head"><h2>Estado del mes</h2></div>${Object.entries(statusLabels).map(([k,name])=>`<div class="summary-row"><span>${name}</span><div class="mini-bar"><b style="width:${ev.length?100*c[k]/ev.length:0}%"></b></div><strong>${c[k]}</strong></div>`).join('')}<div class="readme">Los resultados se consideran <strong>sin configurar</strong> mientras falten códigos RFID en puntos obligatorios.</div></section></div>`;
}
function nameByCode(code){const p=current('points').find(p=>p.code&&p.code.toUpperCase()===String(code).toUpperCase());return p?p.name:`Sin asignar (${code})`}
function readingsFiltered(){return current('readings').filter(r=>r.timestamp.startsWith(filterDate)&&(!readFilter||[r.code,r.device,nameByCode(r.code)].some(v=>String(v).toLowerCase().includes(readFilter.toLowerCase())))).sort((a,b)=>b.timestamp.localeCompare(a.timestamp))}
function renderReadings(){const r=readingsFiltered();const rows=r.slice(0,400).map(x=>`<tr><td>${fmtDT(x.timestamp)}</td><td><code>${safe(x.code)}</code></td><td>${safe(nameByCode(x.code))}</td><td>${safe(x.device)}</td><td>${x.demo?'<span class="chip demo">DEMO</span>':'<span class="chip pending">'+(x.source==='jwm'?'JWM · Nube':'CSV')+'</span>'}</td></tr>`).join('');return header('Lecturas del dispositivo','Registros sin modificar, identificados por el código RFID y el número de lector.',`<button class="btn primary" data-action="import">Importar CSV</button><button class="btn" data-action="csv-lecturas">Exportar CSV</button>`)+banner()+`<section class="panel"><div class="panel-head"><h2>Historial de marcaciones <span class="badge-n">(${r.length})</span></h2><div class="filters"><input type="month" id="month-filter" value="${filterDate}" aria-label="Filtrar por mes"><input type="search" id="read-search" value="${safe(readFilter)}" placeholder="Buscar código, punto o equipo"></div></div>${panelTable(['Fecha y hora','Código RFID','Punto de control','Equipo','Origen'],rows)}${r.length>400?'<p class="muted">Mostrando solo las primeras 400 filas. La exportación incluye todas.</p>':''}</section><input id="file-import" class="sr-only" type="file" accept=".csv,text/csv">`}
function calendarName(employeeId){const name=employee(employeeId)?.name;if(!name)return 'Por asignar';const parts=name.trim().split(/\s+/);return parts.length>1?Array.from(parts[0])[0]+'. '+parts.slice(1).join(' '):name}
function filterCalendarEvaluations(evaluations){return !calendarEmployee?evaluations:evaluations.filter(e=>calendarEmployee==='__unassigned'?!e.s.employeeId:e.s.employeeId===calendarEmployee)}
function renderCalendar(){const [y,m]=filterDate.split('-').map(Number),first=new Date(y,m-1,1),offset=(first.getDay()+6)%7,days=new Date(y,m,0).getDate(),evaluations=filterCalendarEvaluations(getEvaluations(filterDate));
 const grouped=Object.groupBy?Object.groupBy(evaluations,e=>e.date):evaluations.reduce((acc,e)=>{(acc[e.date]??=[]).push(e);return acc},{});
 const head=['Lun','Mar','Mié','Jue','Vie','Sáb','Dom'].map(x=>`<div class="day-header">${x}</div>`).join('');let tiles='';for(let cell=0;cell<Math.ceil((offset+days)/7)*7;cell++){const day=cell-offset+1;if(day<1||day>days){tiles+=`<div class="cal-day outside"></div>`;continue}const dayISO=`${y}-${pad(m)}-${pad(day)}`,es=grouped[dayISO]||[];tiles+=`<div class="cal-day"><div class="day-number">${pad(day)}</div>${es.map(e=>`<div class="calendar-round">${e.s.type==='meters'?'<small>Medidores</small>':''}<span class="calendar-responsible" title="${safe(employee(e.s.employeeId)?.name||'Por asignar')}">${safe(calendarName(e.s.employeeId))}</span> ${evaluationBadge(e)}</div>`).join('')}<button data-action="day-detail" data-day="${dayISO}">Detalle</button></div>`}
 return header('Calendario mensual','Cada casilla muestra las rondas programadas. La lectura de medidores cuenta una vez al mes, durante los últimos 4 días.',`<div class="calendar-filters"><label class="form-field">Conserje<select id="calendar-employee" aria-label="Filtrar calendario por conserje"><option value="">Todos los conserjes</option>${current('employees').map(p=>`<option value="${safe(p.id)}" ${calendarEmployee===p.id?'selected':''}>${safe(p.name)}${p.active?'':' (Archivado)'}</option>`).join('')}<option value="__unassigned" ${calendarEmployee==='__unassigned'?'selected':''}>Por asignar</option></select></label><label class="form-field">Fecha<input aria-label="Seleccionar mes" type="month" id="month-filter" value="${filterDate}"></label><button class="btn" data-action="xlsx">Exportar Excel</button></div>`)+banner()+`<section class="panel"><div class="panel-head"><h2>${new Intl.DateTimeFormat('es-CL',{month:'long',year:'numeric'}).format(first)}</h2><span class="muted">${evaluations.length} rondas programadas</span></div><p class="subhead">Cada marca se asigna una sola vez: ronda más cercana del mismo turno, hasta 2 horas antes o después. El detalle muestra los puntos y horas asociados.</p><div class="cal-grid">${head}${tiles}</div></section>`;
}
function renderPeople(){const list=current('employees');const rows=list.map(e=>`<tr><td class="value-strong">${safe(e.name)}</td><td>${e.active?'<span class="chip ok">Activo</span>':'<span class="chip pending">Archivado</span>'}</td><td><button class="btn small" data-action="edit-person" data-id="${e.id}">Editar</button> <button class="btn small" data-action="toggle-person" data-id="${e.id}">${e.active?'Archivar':'Reactivar'}</button></td></tr>`).join('');return `<div class="panel-head"><h2>Conserjes</h2><button class="btn primary" data-action="add-person">+ Agregar conserje</button><span class="muted">${list.filter(x=>x.active).length} activos</span></div>${panelTable(['Nombre completo','Estado','Acciones'],rows)}`}
function roundPeriod(s){
 if(s.type==='meters')return s.employeeId2?'mixed':'morning';
 const start=s.start||'';
 return start>='08:00'&&start<='15:00'?'morning':start>'15:00'&&start<='22:00'?'afternoon':'night';
}
function roundPeriodBadge(s){const period=roundPeriod(s),labels={morning:'Mañana',afternoon:'Tarde',night:'Noche'};return period==='mixed'?'<span class="round-period morning">☀ Mañana</span> <span class="round-period afternoon">☀ Tarde</span>':'<span class="round-period '+period+'">'+(period==='night'?'☾':'☀')+' '+labels[period]+'</span>'}
function renderRotationNotice(){const rule=bld().weeklyRotation;if(!rule)return '';return '<p class="readme">Rotación semanal desde el lunes '+safe(fmtDate(rule.from))+': <strong>'+safe(employee(rule.morningEmployeeId)?.name||'Por asignar')+'</strong> de mañana y <strong>'+safe(employee(rule.afternoonEmployeeId)?.name||'Por asignar')+'</strong> de tarde en la semana inicial. Se intercambian cada lunes. Aplica a las rondas marcadas como rotativas.</p>'}
function renderSettings(){if(typeof configurationCanWrite!=='function'||!configurationCanWrite())return typeof renderConfigurationGate==='function'?renderConfigurationGate():header('Configuración','Cargando acceso protegido…');let inner='';
 if(tab==='rondas'){
 const rows=current('schedules').map(s=>`<tr class="round-row round-${roundPeriod(s)}"><td>${safe(dayTitle[s.type])}</td><td><div class="round-turn">${safe(s.turn)}</div>${roundPeriodBadge(s)}</td><td>${s.type==='meters'?'08:00–15:00'+(s.employeeId2?' / 15:00–22:00':''):safe(s.start)+'–'+safe(s.end)+(s.offset?' (+1 día)':'')}</td><td>${safe(s.type==='meters'?meterResponsible(s):rotationLabel(s))}</td><td>${s.required.filter(pid=>point(pid)?.active).length}</td><td>${s.active?'Activa':'Archivada'}</td><td><button class="btn small" data-action="edit-round" data-id="${s.id}">Editar</button> <button class="btn small" data-action="toggle-round" data-id="${s.id}">${s.active?'Desactivar':'Activar'}</button> <button class="btn small danger" data-action="delete-round" data-id="${s.id}">Eliminar</button></td></tr>`).join('');inner=`<div class="panel-head"><div><h2>Horarios de rondas</h2><p class="subhead">El fondo indica mañana, tarde o noche según la hora de inicio.</p></div><div class="actions"><button class="btn" data-action="weekly-rotation">Rotación semanal</button><button class="btn primary" data-action="add-round">+ Nueva ronda</button></div></div>${renderRotationNotice()}${panelTable(['Día','Turno','Ventana horaria','Responsable','Puntos obligatorios','Estado','Acciones'],rows)}`;
 }else if(tab==='puntos'){
 const rows=current('points').map(p=>`<tr><td class="value-strong">${safe(p.name)}</td><td><code>${safe(p.code||'Pendiente')}</code></td><td>${p.active?'<span class="chip ok">Activo</span>':'<span class="chip pending">Archivado</span>'}</td><td><button class="btn small" data-action="edit-point" data-id="${p.id}">Editar</button> <button class="btn small" data-action="toggle-point" data-id="${p.id}">${p.active?'Archivar':'Reactivar'}</button></td></tr>`).join('');inner=`<div class="panel-head"><h2>Etiquetas RFID</h2><button class="btn primary" data-action="add-point">+ Nuevo punto</button></div><p class="subhead">Asocia cada código RFID con el lugar físico. Nunca reutilices un código para dos puntos activos.</p>${panelTable(['Punto de control','Código RFID','Estado','Acciones'],rows)}`;
 }else if(tab==='conserjes'){inner=renderPeople();
 }else if(tab==='edificios'){
 const rows=state.buildings.map(b=>`<tr><td>${safe(b.name)}</td><td>${b.demo?'Prueba':'Operativo'}</td><td><button class="btn small" data-action="edit-building" data-id="${b.id}">Editar</button></td></tr>`).join('');inner=`<div class="panel-head"><h2>Edificios</h2><button class="btn primary" data-action="add-building">+ Agregar edificio</button></div>${panelTable(['Nombre','Tipo','Acciones'],rows)}`;
 }else if(tab==='lectores'){
 const rows=current('devices').map(d=>`<tr><td>${safe(d.model)}</td><td>${safe(d.serial)}</td><td>${d.active?'Registrado':'Archivado'}</td><td><button class="btn small" data-action="edit-device" data-id="${d.id}">Editar</button> <button class="btn small" data-action="toggle-device" data-id="${d.id}">${d.active?'Archivar':'Reactivar'}</button></td></tr>`).join('');inner=`<div class="panel-head"><h2>Dispositivos</h2><button class="btn primary" data-action="add-device">+ Agregar lector</button></div>${panelTable(['Modelo','Número de equipo','Estado','Acciones'],rows)}<p class="subhead">Registrar un equipo no establece comunicación USB; requiere el agente Windows.</p>`;
 }
 return header('Configuración','Edita horarios, puntos RFID, conserjes y edificios. Las modificaciones se guardan en la nube.', '<button class="btn" id="configuration-lock">Bloquear Configuración</button>')+banner()+renderConfigurationMigration()+`<div class="tabs">${[['rondas','Horarios y rondas'],['puntos','Puntos de control'],['conserjes','Conserjes'],['edificios','Edificios'],['lectores','Lectores']].map(([k,v])=>`<button class="tab ${tab===k?'selected':''}" data-tab="${k}">${v}</button>`).join('')}</div><section class="panel">${inner}</section><p class="muted" style="margin-top:14px;font-size:12px">Versión inicial: las reglas actuales se aplican al recalcular meses anteriores. La nube conserva versiones de configuración; los informes aún no seleccionan reglas por vigencia.</p>`;
}
function renderSync(){return typeof renderCloudPanel === 'function' ? renderCloudPanel() : header('Sincronización','Cargando conexión con la nube…');}

function peopleStats(evals){const by=new Map();for(const p of current('employees'))by.set(p.id,{name:p.name,n:0,ok:0,incomplete:0,outside:0,missed:0,pending:0,unconfigured:0});by.set('',{name:'Por asignar',n:0,ok:0,incomplete:0,outside:0,missed:0,pending:0,unconfigured:0});for(const ev of evals){const val=by.get(ev.s.employeeId)||by.get('');val.n++;val[ev.status]++}return [...by.values()];}
function renderReports(){const ev=getEvaluations(filterDate),stats=peopleStats(ev);const rows=stats.map(s=>{const expired=s.ok+s.incomplete+s.outside+s.missed;const pct=expired?`${(100*s.ok/expired).toFixed(1).replace('.',',')}%`:'Sin datos';return `<tr><td class="strong">${safe(s.name)}</td><td>${s.n}</td><td>${s.ok}</td><td>${s.outside}</td><td>${s.incomplete}</td><td>${s.missed}</td><td>${s.pending}</td><td>${s.unconfigured}</td><td class="highlight">${pct}</td></tr>`}).join('');return header('Informes mensuales','Informes de cumplimiento por trabajador y exportación de lecturas.',`<input type="month" id="month-filter" value="${filterDate}" aria-label="Mes"><button class="btn primary" data-action="xlsx">Descargar Excel (.xlsx)</button>`)+banner()+`<section class="panel"><div class="panel-head"><h2>Resumen por conserje</h2><span class="muted">${fmtDate(filterDate+'-01').slice(3)} · ${ev.length} rondas</span></div>${panelTable(['Conserje','Asignadas','Cumplidas','Completas fuera de horario','Incompletas','No realizadas','Pendientes','Sin configurar','% cumplimiento'],rows)}<p class="subhead">El porcentaje mide rondas completas dentro del horario y excluye pendientes y sin configurar. Las incompletas pueden incluir lecturas fuera de horario; consulta el detalle.</p></section>`;}
function render(){if(route==='conserjes'){route='configuracion';tab='conserjes';history.replaceState(null,'','#configuracion')}if(typeof configurationRouteChanged==='function')configurationRouteChanged(route);toolbar();document.getElementById('app').innerHTML=({inicio:renderHome,lecturas:renderReadings,calendario:renderCalendar,configuracion:renderSettings,sincronizacion:renderSync,informes:renderReports}[route]||renderHome)();document.title=`${({inicio:'Inicio',lecturas:'Lecturas',calendario:'Calendario',conserjes:'Conserjes',configuracion:'Configuración',sincronizacion:'Sincronización',informes:'Informes'}[route]||'Inicio')} · Control de Rondas`}
function navigate(to){route=to;location.hash=to;setSidebarOpen(false);render()}
function modal(title,fields,submitLabel,callback){const content=document.getElementById('modal-content');content.innerHTML=`<h2>${safe(title)}</h2><div class="forms">${fields.map(f=>`<label class="form-field ${f.full?'full':''}"><span>${safe(f.label)}</span>${f.type==='select'?`<select name="${f.name}">${f.options.map(([v,l])=>`<option value="${safe(v)}" ${String(f.value??'')===String(v)?'selected':''}>${safe(l)}</option>`).join('')}</select>`:`<input name="${f.name}" type="${f.type||'text'}" value="${safe(f.value??'')}" ${f.required?'required':''} ${f.placeholder?`placeholder="${safe(f.placeholder)}"`:''}>`}</label>`).join('')}</div><div class="modal-actions"><button class="btn" value="cancel" type="button" id="cancel-modal">Cancelar</button><button class="btn primary" type="submit">${safe(submitLabel)}</button></div>`;const dlg=document.getElementById('modal');dlg.dataset.view='form';const f=dlg.querySelector('form');f.onsubmit=(e)=>{e.preventDefault();if(!configurationRequire())return;const v=Object.fromEntries(new FormData(f).entries());const res=callback(v);if(res!==false){dlg.close();save();render()}};content.querySelector('#cancel-modal').onclick=()=>dlg.close();dlg.showModal()}
function addEditPerson(pid){const p=current('employees').find(x=>x.id===pid);modal(p?'Editar conserje':'Agregar conserje',[{name:'name',label:'Nombre completo',value:p?.name,required:true}],p?'Guardar':'Agregar',v=>{if(!v.name.trim())return false;if(p)p.name=v.name.trim();else state.employees.push({id:id(),buildingId:state.activeId,name:v.name.trim(),active:true});toast('Conserje guardado')})}
function addEditPoint(pid){
 const p=current('points').find(x=>x.id===pid);
 modal(p?'Editar punto RFID':'Agregar punto RFID',
  [{name:'name',label:'Nombre del punto',value:p?.name,required:true},
   {name:'code',label:'Código RFID (dejar vacío si se desconoce)',value:p?.code||'',placeholder:'Ej. 0445'}],
  p?'Guardar':'Agregar',v=>{
   const code=v.code.trim().toUpperCase(),name=v.name.trim();
   if(!name)return false;
   if(code&&current('points').some(q=>q.id!==pid&&q.active&&q.code.toUpperCase()===code)){
     toast('Ese código RFID ya está asignado a otro punto activo');return false;
   }
   if(p)Object.assign(p,{name,code});else state.points.push({id:id(),buildingId:state.activeId,name,code,active:true});
   toast('Punto guardado');
  });
 const input=document.querySelector('#modal-content input[name="code"]');
 if(!input)return;
 const label=input.closest('.form-field');
 const wrap=document.createElement('div');wrap.className='rfid-code-input';
 input.parentNode.insertBefore(wrap,input);wrap.appendChild(input);
 const btn=document.createElement('button');btn.type='button';btn.className='btn rfid-read-button';btn.textContent='Leer';
 btn.setAttribute('aria-label','Leer código RFID mediante lector USB');wrap.appendChild(btn);
 const hint=document.createElement('p');hint.className='rfid-hint';
 hint.setAttribute('role','status');hint.setAttribute('aria-live','polite');
 hint.textContent='Conecta el lector JWM por USB y cierra el programa de JWM antes de pulsar Leer.';
 label.appendChild(hint);
 btn.addEventListener('click',()=>tryReadRFID(btn,hint));
}
async function tryReadRFID(button, hint) {
 button.disabled = true;
 button.textContent = 'Leyendo…';
 hint.textContent = 'Selecciona el lector Silicon Labs CP210x.';
 try {
   await withJwmReader(({ serial }) => {
     hint.textContent = 'Lector JWM ' + serial + ' identificado. La descarga del código RFID sigue en validación.';
   });
 } catch (error) {
   if (error.name === 'NotFoundError') {
     hint.textContent = 'No seleccionaste ningún puerto.';
   } else if (error.name === 'NetworkError' || error.name === 'InvalidStateError') {
     hint.textContent = 'No se pudo acceder al puerto. Verifica el USB y cierra JWM si está abierto.';
   } else {
     hint.textContent = error.message || 'Falló la comunicación con el lector.';
   }
 } finally {
   button.disabled = false;
   button.textContent = 'Leer';
 }
}
function addEditBuilding(bid){const b=state.buildings.find(x=>x.id===bid);modal(b?'Editar edificio':'Agregar edificio',[{name:'name',label:'Nombre del edificio',value:b?.name,required:true}],b?'Guardar':'Agregar',v=>{if(!v.name.trim())return false;if(b)b.name=v.name.trim();else{const newId=id();state.buildings.push({id:newId,name:v.name.trim(),demo:false});state.activeId=newId}toast('Edificio guardado')})}
function addEditDevice(did){const d=current('devices').find(x=>x.id===did);modal(d?'Editar lector':'Agregar lector',[{name:'model',label:'Modelo del lector',value:d?.model||'JWM 5000V1',required:true},{name:'serial',label:'Número de equipo',value:d?.serial,required:true}],d?'Guardar':'Agregar',v=>{if(!v.model.trim()||!v.serial.trim())return false;if(current('devices').some(q=>q.id!==did&&q.serial===v.serial.trim())){toast('Ese equipo ya está registrado');return false}if(d)Object.assign(d,{model:v.model.trim(),serial:v.serial.trim()});else state.devices.push({id:id(),buildingId:state.activeId,model:v.model.trim(),serial:v.serial.trim(),active:true});toast('Lector guardado')})}
function addEditRound(sid){
 const s=current('schedules').find(x=>x.id===sid),pts=activePoints(),people=[['','Por asignar'],...current('employees').filter(x=>x.active||x.id===s?.employeeId||x.id===s?.employeeId2).map(p=>[p.id,p.name])];
 const fields=[{name:'rotationShift',label:'Asignación semanal',type:'select',value:s?.rotationShift||'',options:[['','Responsable fijo'],['morning','Mañana rotativa'],['afternoon','Tarde rotativa'],['meters','Medidores: ambos conserjes rotativos']]},{name:'type',label:'Tipo de día',type:'select',value:s?.type||'weekday',options:Object.entries(dayTitle)},
 {name:'turn',label:'Nombre del turno',value:s?.turn||'Mañana',required:true},
 {name:'start',label:'Hora de inicio',type:'time',value:s?.start||'10:00',required:true},
 {name:'end',label:'Hora de término',type:'time',value:s?.end||'11:00',required:true},
 {name:'offset',label:'Día de ejecución',type:'select',value:String(s?.offset??0),options:[['0','El mismo día'],['1','Día siguiente']]},
 {name:'employeeId',label:'Conserje responsable / Mañana (08:00–15:00)',type:'select',value:s?.employeeId||'',options:people},
 {name:'employeeId2',label:'Conserje de tarde (15:00–22:00, opcional)',type:'select',value:s?.employeeId2||'',options:[['','Sin segunda asignación'],...people.slice(1)]}];
 const dlg=document.getElementById('modal');
 modal(s?'Editar ronda':'Agregar ronda',fields,s?'Guardar':'Crear',v=>{
  const monthly=v.type==='meters',required=[...dlg.querySelectorAll('[name="required"]:checked')].map(x=>x.value);
  if(!required.length){toast('Elige al menos un punto obligatorio');return false}
  if(v.rotationShift&&(!bld().weeklyRotation||monthly!==(v.rotationShift==='meters'))){toast('Configura la rotación semanal y elige una opción acorde al tipo de ronda');return false}
  const val={rotationShift:v.rotationShift,type:v.type,turn:monthly?'Lectura de Medidores':v.turn.trim(),start:monthly?'08:00':v.start,end:monthly?'15:00':v.end,offset:monthly?0:Number(v.offset),employeeId:v.employeeId,employeeId2:monthly?v.employeeId2:'',meterTimed:monthly,start2:monthly?'15:00':'',end2:monthly?'22:00':'',required};
  if(!val.turn||!val.start||!val.end){toast('Completa los campos de la ronda');return false}
  if(monthly){
   if(!v.rotationShift&&val.employeeId2&&(!val.employeeId||val.employeeId===val.employeeId2)){toast('Selecciona dos conserjes distintos');return false}
  }
  if(s)Object.assign(s,val);else state.schedules.push({id:id(),buildingId:state.activeId,active:true,...val});toast('Ronda guardada');
 });
 const node=document.getElementById('modal-content');
 node.querySelector('.forms').insertAdjacentHTML('beforeend',`<div class="form-field full"><span>Puntos obligatorios para esta ronda</span><div class="grid" style="gap:6px;grid-template-columns:1fr 1fr;max-height:180px;overflow:auto;border:1px solid var(--border);border-radius:8px;padding:8px">${pts.map(p=>`<label class="required-point"><input type="checkbox" name="required" value="${p.id}" ${(s?s.required.includes(p.id):true)?'checked':''}><span>${safe(p.name)}</span></label>`).join('')}</div></div>`);
 const typeInput=node.querySelector('[name="type"]'),meterHint=document.createElement('p');meterHint.className='readme';meterHint.textContent='Cada conserje debe completar todos los puntos una vez en los últimos 4 días del mes, dentro de su propio horario. Mañana y tarde se evalúan por separado. Horarios fijos: mañana de 08:00 a 15:00; tarde de 15:00 a 22:00. Una marca exactamente a las 15:00 pertenece a la tarde.';node.prepend(meterHint);
 const update=()=>{const monthly=typeInput.value==='meters';meterHint.hidden=!monthly;
  for(const name of ['turn','start','end','offset','employeeId2']){
   const input=node.querySelector('[name="'+name+'"]'),show=['turn','start','end','offset'].includes(name)?!monthly:monthly;
   input.closest('.form-field').style.display=show?'':'none';input.disabled=!show;
  }
 };
 typeInput.addEventListener('change',update);node.querySelector('[name="employeeId2"]').addEventListener('change',update);update();
}
function editWeeklyRotation(){
 const rule=bld().weeklyRotation||{},people=[['','Seleccionar'],...current('employees').filter(p=>p.active).map(p=>[p.id,p.name])];
 modal('Rotación semanal',[{name:'from',label:'Lunes de inicio',type:'date',value:rule.from||'2026-11-23',required:true},{name:'morningEmployeeId',label:'Mañana en la semana inicial',type:'select',value:rule.morningEmployeeId||'',options:people},{name:'afternoonEmployeeId',label:'Tarde en la semana inicial',type:'select',value:rule.afternoonEmployeeId||'',options:people}],'Guardar',v=>{
  if(toDate(v.from).getDay()!==1||!v.morningEmployeeId||!v.afternoonEmployeeId||v.morningEmployeeId===v.afternoonEmployeeId){toast('Elige un lunes y dos conserjes distintos');return false}
  bld().weeklyRotation={from:v.from,morningEmployeeId:v.morningEmployeeId,afternoonEmployeeId:v.afternoonEmployeeId,workDays:[1,2,3,4,5,6]};toast('Rotación semanal guardada');
 });
 document.getElementById('modal-content').insertAdjacentHTML('beforeend','<p class="readme">Los responsables se intercambian cada lunes a partir de la fecha indicada. Esta rotación corresponde a lunes a sábado; los domingos quedan fuera de la lectura de medidores de estos dos conserjes. En cada ronda puedes seleccionar responsable fijo, mañana rotativa, tarde rotativa o medidores rotativos. Las fechas anteriores conservan su asignación original.</p>');
}
function deleteRound(sid){
 const buildingId=state.activeId,s=current('schedules').find(x=>x.id===sid);if(!s)return;
 modal('Eliminar ronda',[],'Eliminar',()=>{
  if(state.activeId!==buildingId){toast('El edificio cambió. Vuelve a seleccionar la ronda.');return false}
  const index=state.schedules.findIndex(x=>x.id===sid&&x.buildingId===buildingId);
  if(index<0)return false;
  state.schedules.splice(index,1);toast('Ronda eliminada');
 });
 const content=document.getElementById('modal-content');
 content.querySelector('.forms').innerHTML='<p class="form-field full">¿Eliminar la ronda «'+safe(s.turn)+'» ('+safe(dayTitle[s.type])+')? Esta acción no se puede deshacer. La ronda dejará de aparecer en el calendario y en los informes, incluidos los meses anteriores. Las lecturas del dispositivo se conservan.</p>';
 content.querySelector('[type="submit"]').className='btn danger';
}
function toggleIn(collection,pid){const obj=state[collection].find(x=>x.id===pid&&x.buildingId===state.activeId);if(obj){obj.active=!obj.active;save();render();toast('Estado actualizado')}}
function normalizeTimestamp(s){const raw=String(s||'').trim();let m=raw.match(/^(\d{2})[-\/.](\d{2})[-\/.](\d{4})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?/);if(m)return `${m[3]}-${m[2]}-${m[1]}T${pad(m[4])}:${m[5]}:${m[6]||'00'}`;m=raw.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/);if(m)return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]||'00'}`;return null}
function parseCSV(text){const first=text.replace(/^\uFEFF/,'').split(/\r?\n/)[0]||'',sep=(first.match(/;/g)||[]).length>(first.match(/,/g)||[]).length?';':',';const rows=[],arr=[];let cell='',inQ=false,row=[];const txt=text.replace(/^\uFEFF/,'');for(let i=0;i<txt.length;i++){const c=txt[i];if(c==='"'){if(inQ&&txt[i+1]==='"'){cell+='"';i++}else inQ=!inQ}else if(c===sep&&!inQ){row.push(cell);cell=''}else if((c==='\n'||c==='\r')&&!inQ){if(c==='\r'&&txt[i+1]==='\n')i++;row.push(cell);if(row.some(c=>c.trim()))rows.push(row);row=[];cell=''}else cell+=c}row.push(cell);if(row.some(c=>c.trim()))rows.push(row);return rows}
function importFile(file){const reader=new FileReader();reader.onload=()=>{try{const rows=parseCSV(String(reader.result));if(rows.length<2){toast('CSV sin registros');return}const headers=rows[0].map(x=>x.toLowerCase().trim()),index=names=>headers.findIndex(h=>names.some(n=>h.includes(n)));let iDate=index(['fecha','timestamp','date']),iCode=index(['código','codigo','rfid','code']),iDevice=index(['equipo','device','lector']);if(iDate<0)iDate=0;if(iCode<0)iCode=1;if(iDevice<0)iDevice=3;let added=0,duplicated=0,invalid=0;const keys=new Set(state.readings.filter(belongs).map(r=>[r.device,r.timestamp,r.code].join('|')));for(const row of rows.slice(1)){const timestamp=normalizeTimestamp(row[iDate]),code=(row[iCode]||'').trim().toUpperCase(),device=(row[iDevice]||'').trim()||'Sin identificar';if(!timestamp||!code){invalid++;continue}const key=[device,timestamp,code].join('|');if(keys.has(key)){duplicated++;continue}state.readings.push({id:id(),buildingId:state.activeId,timestamp,code,device,demo:false,source:'csv'});keys.add(key);added++}save();render();toast(`Importación: ${added} nuevos, ${duplicated} duplicados y ${invalid} inválidos`)}catch(e){toast('No se pudo leer el CSV: '+e.message)}};reader.readAsText(file,'UTF-8')}
function downloadCSV(name,rows){const esc=x=>`"${String(x??'').replace(/"/g,'""')}"`,content='\uFEFF'+rows.map(r=>r.map(esc).join(';')).join('\r\n');const blob=new Blob([content],{type:'text/csv;charset=utf-8;'});downloadBlob(name,blob)}
function downloadBlob(name,blob){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),2000)}
function reportData(){const evals=getEvaluations(filterDate),c=current('points'),people=peopleStats(evals);const calendar=[['Fecha','Día','Turno','Inicio','Fin','Responsable',...c.filter(p=>p.active).map(p=>p.name),'Puntos revisados','Puntos exigidos','Estado','Horario','Primera lectura asociada','Última lectura asociada','Observación']];for(const e of evals)calendar.push([fmtDate(e.date),weekdays[toDate(e.date).getDay()],e.s.turn,e.window.start.slice(11,16),e.window.end.slice(11,16),employee(e.s.employeeId)?.name||'Por asignar',...c.filter(p=>p.active).map(p=>e.status==='unconfigured'?'Sin configurar':e.visits?.some(v=>v.id===p.id)?'Revisado':'No registrado'),e.count,e.total,evaluationLabel(e),timingLabel(e),e.logs?.length?fmtDT(e.logs.map(r=>r.timestamp).sort()[0]):'',e.logs?.length?fmtDT(e.logs.map(r=>r.timestamp).sort().at(-1)):'',(e.s.type==='meters'?'Una vez entre '+fmtDate(e.window.start.slice(0,10))+' y '+fmtDate(e.window.end.slice(0,10))+'. ':'')+(e.missing?.map(p=>p.name).join(', ')||'')]);const reads=[['Fecha y hora','Código','Punto de control','Equipo'],...current('readings').slice().sort((a,b)=>a.timestamp.localeCompare(b.timestamp)).map(r=>[fmtDT(r.timestamp),r.code,nameByCode(r.code),r.device])];const config=[['Día','Turno','Inicio','Fin','Desfase día','Conserje','Puntos obligatorios'],...current('schedules').map(s=>[dayTitle[s.type],s.turn,s.start,s.end,s.offset,s.type==='meters'?meterResponsible(s):rotationLabel(s),s.required.map(pid=>point(pid)?.name||pid).join(', ')]),[],['Código','Punto de control'],...c.map(p=>[p.code,p.name])];const summary=[['Conserje asignado','Asignadas','Cumplidas','Completas fuera de horario','Incompletas','No realizadas','Pendientes','Sin configurar','% cumplimiento'],...people.map(s=>{const n=s.ok+s.incomplete+s.outside+s.missed;return [s.name,s.n,s.ok,s.outside,s.incomplete,s.missed,s.pending,s.unconfigured,n?Number((100*s.ok/n).toFixed(1))/100:'Sin datos']})];return [['Calendario mensual',calendar],['Lecturas',reads],['Configuración',config],['Resumen por conserje',summary]]}
function exportXLSX(){if(!window.XLSX){toast('No se cargó la biblioteca de Excel; revisa tu conexión a internet');return}const wb=XLSX.utils.book_new();for(const [name,data] of reportData()){const ws=XLSX.utils.aoa_to_sheet(data);ws['!cols']=data[0].map((v,i)=>({wch:Math.min(36,Math.max(15,String(v||'').length+4))}));XLSX.utils.book_append_sheet(wb,ws,name)}XLSX.writeFile(wb,`control-rondas-${bld().name.replace(/[^a-z0-9]/gi,'-')}-${filterDate}.xlsx`);toast('Informe Excel generado')}
function dayDetails(day){
 const es=filterCalendarEvaluations(getEvaluations(day.slice(0,7))).filter(e=>e.date===day),dlg=document.getElementById('modal'),node=document.getElementById('modal-content');
 node.innerHTML=`<h2>Rondas del ${fmtDate(day)}</h2>${es.map(e=>{
  const start=e.s.meterRotating?'08:00':e.window.start.slice(11,16),end=e.s.meterRotating?'22:00':e.window.end.slice(11,16);
  return `<div style="padding:10px 0;border-bottom:1px solid var(--border)"><b>${safe(e.s.turn)} | ${start} - ${end} | ${safe(employee(e.s.employeeId)?.name||'Por asignar')}</b><p>${evaluationBadge(e)} puntos</p>${e.missing?.length?`<p class="muted">Faltantes: ${e.missing.map(p=>safe(p.name)).join(', ')}</p>`:''}${e.logs?.length?`<p class="muted">Lecturas asociadas:</p><ul>${e.logs.slice().sort((a,b)=>a.timestamp.localeCompare(b.timestamp)).map(r=>`<li>${safe(r.timestamp.slice(11,16))} | ${safe(nameByCode(r.code))}</li>`).join('')}</ul>`:''}</div>`;
 }).join('')}<div class="modal-actions"><button class="btn" type="button" id="done-day">Cerrar</button></div>`;
 node.querySelector('#done-day').onclick=()=>dlg.close();dlg.dataset.view='detail';dlg.querySelector('form').onsubmit=e=>e.preventDefault();dlg.showModal();
}
function demo(){if(state.buildings.some(b=>b.demo)){state.activeId=state.buildings.find(b=>b.demo).id;save();render();return}const buildingId='demostracion';state.buildings.push({id:buildingId,name:'Edificio demostración',demo:true});const ps=['Sala de bombas','Grupo electrógeno','Estacionamiento -1','Sala de basura'].map((name,i)=>({id:id(),buildingId,name,code:`D0${i+1}A`,active:true}));state.points.push(...ps);const em=id();state.employees.push({id:em,buildingId,name:'Conserje de prueba',active:true});const now=dateParts().today;for(const type of ['weekday','saturday','sunday'])state.schedules.push({id:id(),buildingId,type,turn:'Mañana',start:'10:00',end:'11:15',offset:0,employeeId:em,required:ps.map(p=>p.id),active:true});const start=addDays(now,-1),t=dayType(start);for(let i=0;i<4;i++){state.readings.push({id:id(),buildingId,timestamp:`${start}T10:${pad(5+i*3)}:00`,code:ps[i].code,device:'DEMO-01',demo:true,source:'demo'})}state.activeId=buildingId;filterDate=start.slice(0,7);save();render();toast('Se creó un edificio de demostración independiente. Todos sus registros son ficticios.')}
document.addEventListener('click',e=>{
 const nav=e.target.closest('[data-route-action]');if(nav){navigate(nav.dataset.routeAction);return}
 const tabs=e.target.closest('[data-tab]');if(tabs){if(!configurationRequire())return;tab=tabs.dataset.tab;render();return}
 const action=e.target.closest('[data-action]');if(!action)return;const act=action.dataset.action,pid=action.dataset.id;
 if(/^(add|edit|toggle|delete)-(person|point|round|building|device)$/.test(act)||act==='import'||act==='weekly-rotation'){if(typeof configurationRequire!=='function'||!configurationRequire())return}
 if(act==='add-person'||act==='edit-person')return addEditPerson(pid);
 if(act==='add-point'||act==='edit-point')return addEditPoint(pid);
 if(act==='add-round'||act==='edit-round')return addEditRound(pid);
 if(act==='add-building'||act==='edit-building')return addEditBuilding(pid);
 if(act==='add-device'||act==='edit-device')return addEditDevice(pid);
 if(act==='toggle-person')return toggleIn('employees',pid);
 if(act==='toggle-point')return toggleIn('points',pid);
 if(act==='toggle-round')return toggleIn('schedules',pid);
 if(act==='weekly-rotation')return editWeeklyRotation();
 if(act==='delete-round')return deleteRound(pid);
 if(act==='toggle-device')return toggleIn('devices',pid);
 if(act==='import')return document.getElementById('file-import').click();
 if(act==='csv-lecturas')return downloadCSV(`lecturas-${filterDate}.csv`,[['Fecha y hora','Código','Punto de control','Equipo'],...readingsFiltered().map(r=>[fmtDT(r.timestamp),r.code,nameByCode(r.code),r.device])]);
 if(act==='xlsx')return exportXLSX();
 if(act==='day-detail')return dayDetails(action.dataset.day);
 if(act==='demo')return demo();
});
document.addEventListener('change',e=>{if(e.target.id==='building-picker'){state.activeId=e.target.value;calendarEmployee='';save();render()}if(e.target.id==='calendar-employee'){calendarEmployee=e.target.value;render()}if(e.target.id==='month-filter'){filterDate=e.target.value||dateParts().month;render()}if(e.target.id==='file-import'&&e.target.files?.[0])importFile(e.target.files[0])});
document.addEventListener('input',e=>{if(e.target.id==='read-search'){readFilter=e.target.value;const pos=e.target.selectionStart;render();const el=document.getElementById('read-search');el.focus();el.setSelectionRange(pos,pos)}});
function setSidebarOpen(open,restoreFocus=false){
 const sidebar=document.getElementById('sidebar'),menu=document.getElementById('menu-button');
 sidebar.classList.toggle('open',open);
 document.getElementById('sidebar-backdrop').hidden=!open;
 document.body.classList.toggle('sidebar-open',open);
 menu.setAttribute('aria-expanded',String(open));
 if(open)document.getElementById('sidebar-close').focus();
 else if(restoreFocus)menu.focus();
}
const modalDialog=document.getElementById('modal');
let detailBackdropPressed=false;
function isDetailBackdrop(event){
 if(modalDialog.dataset.view!=='detail'||event.target!==modalDialog)return false;
 const rect=modalDialog.getBoundingClientRect();
 return event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom;
}
document.getElementById('modal-close').onclick=()=>modalDialog.close();
modalDialog.onpointerdown=event=>{detailBackdropPressed=isDetailBackdrop(event)};
modalDialog.onclick=event=>{if(detailBackdropPressed&&isDetailBackdrop(event))modalDialog.close();detailBackdropPressed=false};
modalDialog.onclose=()=>{detailBackdropPressed=false};
document.getElementById('menu-button').onclick=()=>setSidebarOpen(!document.getElementById('sidebar').classList.contains('open'));
document.getElementById('sidebar-close').onclick=()=>setSidebarOpen(false,true);
document.getElementById('sidebar-backdrop').onclick=()=>setSidebarOpen(false,true);
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&document.getElementById('sidebar').classList.contains('open'))setSidebarOpen(false,true)});
window.matchMedia('(max-width:760px)').addEventListener('change',()=>setSidebarOpen(false));
window.addEventListener('hashchange',()=>{setSidebarOpen(false);route=(location.hash||'#inicio').slice(1);render()});
route=(location.hash||'#inicio').slice(1);render();
// Interfaz estática con datos autenticados en Supabase.
