'use strict';
/* Control de Rondas: configuración compartida y auxiliar USB independiente. */
const KEY='control-rondas-gh-v1';
const pointNames=['Sala de Bombas','Grupo Electrógeno','Estacionamiento de Visitas 1','Estacionamiento de Visitas 2','Sala de Basura 1','Sala de Basura 2','Sala de Calderas','A. Caliente 1 - O','A. Caliente 1 - P','A. Caliente 2 - O','A. Caliente 2 - P','A. Caliente 3 - O','A. Caliente 3 - P','A. Caliente 4 - O','A. Caliente 4 - P','A. Caliente 5 - O','A. Caliente 5 - P'];
const weekdays=['Domingo','Lunes','Martes','Miércoles','Jueves','Viernes','Sábado'];
const statusLabels={ok:'Cumplida',incomplete:'Incompleta',outside:'Fuera de horario',missed:'No realizada',pending:'Pendiente',unconfigured:'Sin configurar'};
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
let route='inicio',tab='rondas',filterDate=dateParts().month,readFilter='',search='',viewDay='',refDate=new Date();
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
function meterWindow(month){
 const [year,monthNumber]=month.split('-').map(Number),last=new Date(year,monthNumber,0).getDate();
 return {start:month+'-'+pad(last-3)+'T00:00:00',end:month+'-'+pad(last)+'T23:59:59'};
}
function evaluateMeters(month,s,now=dtISO(new Date())){
 const w=meterWindow(month),expected=s.required.map(point),valid=expected.length>0&&expected.every(p=>p&&p.active&&p.code.trim()!=='');
 const result={date:w.end.slice(0,10),window:w,s,status:'unconfigured',count:0,total:expected.length,visits:[],missing:expected.filter(Boolean)};
 if(!valid)return result;
 const logs=current('readings').filter(r=>r.timestamp>=w.start&&r.timestamp<=w.end&&r.timestamp<=now).slice().sort((a,b)=>a.timestamp.localeCompare(b.timestamp));
 const codes=new Set();let completed='';
 for(const log of logs){codes.add(String(log.code).toUpperCase());if(expected.every(p=>codes.has(p.code.toUpperCase()))){completed=log.timestamp.slice(0,10);break}}
 result.visits=expected.filter(p=>codes.has(p.code.toUpperCase()));result.count=result.visits.length;result.missing=expected.filter(p=>!codes.has(p.code.toUpperCase()));
 if(completed){result.date=completed;result.status='ok'}else result.status=now<=w.end?'pending':result.count?'incomplete':'missed';
 return result;
}
const getWindow=(date,s)=>{
 const st=addDays(date,s.offset||0)+'T'+s.start+':00';
 let en=addDays(date,s.offset||0)+'T'+s.end+':00';
 if(en<st)en=addDays(date,(s.offset||0)+1)+'T'+s.end+':00';
 return {start:st,end:en};
};
function evaluate(date,s,now=dtISO(new Date())){
 const w=getWindow(date,s), expected=s.required.map(point),valid=expected.length>0&&expected.every(p=>p&&p.active&&p.code.trim()!=='');
 if(!valid)return {date,window:w,s,status:'unconfigured',count:0,total:expected.length,visits:[]};
 if(now<w.end)return {date,window:w,s,status:'pending',count:0,total:expected.length,visits:[]};
 const logs=current('readings').filter(r=>r.timestamp>=w.start&&r.timestamp<=w.end);
 const codes=new Set(logs.map(r=>String(r.code).toUpperCase()));
 const visited=expected.filter(p=>codes.has(p.code.toUpperCase()));
 let status='ok';
 if(visited.length<expected.length){
   const elsewhere=current('readings').some(r=>r.timestamp>=addDays(w.start.slice(0,10),-1)+'T00:00:00'&&r.timestamp<=addDays(w.end.slice(0,10),1)+'T23:59:59'&&expected.some(p=>p.code.toUpperCase()===r.code.toUpperCase()));
   status=visited.length?'incomplete':(elsewhere?'outside':'missed');
 }
 return {date,window:w,s,status,count:visited.length,total:expected.length,visits:visited,missing:expected.filter(p=>!codes.has(p.code.toUpperCase()))};
}
function getEvaluations(month){const monthly=activeSchedules().filter(s=>s.type==='meters').map(s=>evaluateMeters(month,s));const [y,m]=month.split('-').map(Number),n=new Date(y,m,0).getDate(),arr=[...monthly];for(let d=1;d<=n;d++){const day=`${y}-${pad(m)}-${pad(d)}`;for(const s of activeSchedules().filter(x=>scheduleApplies(x.type,day)))arr.push(evaluate(day,s))}return arr}
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
function renderCalendar(){const [y,m]=filterDate.split('-').map(Number),first=new Date(y,m-1,1),offset=first.getDay(),days=new Date(y,m,0).getDate(),evaluations=getEvaluations(filterDate);
 const grouped=Object.groupBy?Object.groupBy(evaluations,e=>e.date):evaluations.reduce((acc,e)=>{(acc[e.date]??=[]).push(e);return acc},{});
 const head=['D','L','M','M','J','V','S'].map(x=>`<div class="day-header">${x}</div>`).join('');let tiles='';for(let cell=0;cell<Math.ceil((offset+days)/7)*7;cell++){const day=cell-offset+1;if(day<1||day>days){tiles+=`<div class="cal-day outside"></div>`;continue}const dayISO=`${y}-${pad(m)}-${pad(day)}`,es=grouped[dayISO]||[];tiles+=`<div class="cal-day"><div class="day-number">${pad(day)}</div>${es.map(e=>`<div>${e.s.type==='meters'?'<small>Medidores</small> ':''}${badge(e.status)}</div>`).join('')}<button data-action="day-detail" data-day="${dayISO}">Detalle</button></div>`}
 return header('Calendario mensual','Cada casilla muestra las rondas programadas. La lectura de medidores cuenta una vez al mes, durante los últimos 4 días.',`<input aria-label="Seleccionar mes" type="month" id="month-filter" value="${filterDate}"><button class="btn" data-action="xlsx">Exportar Excel</button>`)+banner()+`<section class="panel"><div class="panel-head"><h2>${new Intl.DateTimeFormat('es-CL',{month:'long',year:'numeric'}).format(first)}</h2><span class="muted">${evaluations.length} rondas programadas</span></div><div class="cal-grid">${head}${tiles}</div></section>`;
}
function renderPeople(){const list=current('employees');const rows=list.map(e=>`<tr><td class="value-strong">${safe(e.name)}</td><td>${e.active?'<span class="chip ok">Activo</span>':'<span class="chip pending">Archivado</span>'}</td><td><button class="btn small" data-action="edit-person" data-id="${e.id}">Editar</button> <button class="btn small" data-action="toggle-person" data-id="${e.id}">${e.active?'Archivar':'Reactivar'}</button></td></tr>`).join('');return `<div class="panel-head"><h2>Conserjes</h2><button class="btn primary" data-action="add-person">+ Agregar conserje</button><span class="muted">${list.filter(x=>x.active).length} activos</span></div>${panelTable(['Nombre completo','Estado','Acciones'],rows)}`}
function renderSettings(){if(typeof configurationCanWrite!=='function'||!configurationCanWrite())return typeof renderConfigurationGate==='function'?renderConfigurationGate():header('Configuración','Cargando acceso protegido…');let inner='';
 if(tab==='rondas'){
 const rows=current('schedules').map(s=>`<tr><td>${safe(dayTitle[s.type])}</td><td>${safe(s.turn)}</td><td>${safe(s.start)}–${safe(s.end)} ${s.offset?'(+1 día)':''}</td><td>${safe(employee(s.employeeId)?.name||'Por asignar')}</td><td>${s.required.filter(pid=>point(pid)?.active).length}</td><td>${s.active?'Activa':'Archivada'}</td><td><button class="btn small" data-action="edit-round" data-id="${s.id}">Editar</button> <button class="btn small" data-action="toggle-round" data-id="${s.id}">${s.active?'Desactivar':'Activar'}</button></td></tr>`).join('');inner=`<div class="panel-head"><h2>Horarios de rondas</h2><button class="btn primary" data-action="add-round">+ Nueva ronda</button></div>${panelTable(['Día','Turno','Ventana horaria','Responsable','Puntos obligatorios','Estado','Acciones'],rows)}`;
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
function renderReports(){const ev=getEvaluations(filterDate),stats=peopleStats(ev);const rows=stats.map(s=>{const expired=s.ok+s.incomplete+s.outside+s.missed;const pct=expired?`${(100*s.ok/expired).toFixed(1).replace('.',',')}%`:'Sin datos';return `<tr><td class="strong">${safe(s.name)}</td><td>${s.n}</td><td>${s.ok}</td><td>${s.outside}</td><td>${s.incomplete}</td><td>${s.missed}</td><td>${s.pending}</td><td>${s.unconfigured}</td><td class="highlight">${pct}</td></tr>`}).join('');return header('Informes mensuales','Informes de cumplimiento por trabajador y exportación de lecturas.',`<input type="month" id="month-filter" value="${filterDate}" aria-label="Mes"><button class="btn primary" data-action="xlsx">Descargar Excel (.xlsx)</button>`)+banner()+`<section class="panel"><div class="panel-head"><h2>Resumen por conserje</h2><span class="muted">${fmtDate(filterDate+'-01').slice(3)} · ${ev.length} rondas</span></div>${panelTable(['Conserje','Asignadas','Cumplidas','Fuera de horario','Incompletas','No realizadas','Pendientes','Sin configurar','% cumplimiento'],rows)}<p class="subhead">El porcentaje excluye pendientes y rondas sin configurar.</p></section>`;}
function render(){if(route==='conserjes'){route='configuracion';tab='conserjes';history.replaceState(null,'','#configuracion')}if(typeof configurationRouteChanged==='function')configurationRouteChanged(route);toolbar();document.getElementById('app').innerHTML=({inicio:renderHome,lecturas:renderReadings,calendario:renderCalendar,configuracion:renderSettings,sincronizacion:renderSync,informes:renderReports}[route]||renderHome)();document.title=`${({inicio:'Inicio',lecturas:'Lecturas',calendario:'Calendario',conserjes:'Conserjes',configuracion:'Configuración',sincronizacion:'Sincronización',informes:'Informes'}[route]||'Inicio')} · Control de Rondas`}
function navigate(to){route=to;location.hash=to;setSidebarOpen(false);render()}
function modal(title,fields,submitLabel,callback){const content=document.getElementById('modal-content');content.innerHTML=`<h2>${safe(title)}</h2><div class="forms">${fields.map(f=>`<label class="form-field ${f.full?'full':''}"><span>${safe(f.label)}</span>${f.type==='select'?`<select name="${f.name}">${f.options.map(([v,l])=>`<option value="${safe(v)}" ${String(f.value??'')===String(v)?'selected':''}>${safe(l)}</option>`).join('')}</select>`:`<input name="${f.name}" type="${f.type||'text'}" value="${safe(f.value??'')}" ${f.required?'required':''} ${f.placeholder?`placeholder="${safe(f.placeholder)}"`:''}>`}</label>`).join('')}</div><div class="modal-actions"><button class="btn" value="cancel" type="button" id="cancel-modal">Cancelar</button><button class="btn primary" type="submit">${safe(submitLabel)}</button></div>`;const dlg=document.getElementById('modal');const f=dlg.querySelector('form');f.onsubmit=(e)=>{e.preventDefault();if(!configurationRequire())return;const v=Object.fromEntries(new FormData(f).entries());const res=callback(v);if(res!==false){dlg.close();save();render()}};content.querySelector('#cancel-modal').onclick=()=>dlg.close();dlg.showModal()}
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
function addEditRound(sid){const s=current('schedules').find(x=>x.id===sid);const pts=activePoints();const fields=[{name:'type',label:'Tipo de día',type:'select',value:s?.type||'weekday',options:Object.entries(dayTitle)},{name:'turn',label:'Nombre del turno',value:s?.turn||'Mañana',required:true},{name:'start',label:'Hora de inicio',type:'time',value:s?.start||'10:00',required:true},{name:'end',label:'Hora de término',type:'time',value:s?.end||'11:00',required:true},{name:'offset',label:'Día de ejecución',type:'select',value:String(s?.offset??0),options:[['0','El mismo día'],['1','Día siguiente']]},{name:'employeeId',label:'Conserje responsable',type:'select',value:s?.employeeId||'',options:[['','Por asignar'],...current('employees').filter(x=>x.active).map(p=>[p.id,p.name])]}];
 const dlg=document.getElementById('modal');modal(s?'Editar ronda':'Agregar ronda',fields,s?'Guardar':'Crear',v=>{const val={type:v.type,turn:v.type==='meters'?'Lectura de Medidores':v.turn.trim(),start:v.type==='meters'?'00:00':v.start,end:v.type==='meters'?'23:59':v.end,offset:v.type==='meters'?0:Number(v.offset),employeeId:v.employeeId};if(!val.turn||!val.start||!val.end){toast('Completa los campos de la ronda');return false}if(s)Object.assign(s,val);else state.schedules.push({id:id(),buildingId:state.activeId,active:true,required:pts.map(p=>p.id),...val});toast('Ronda guardada')});
 const node=document.getElementById('modal-content');node.querySelector('.forms').insertAdjacentHTML('beforeend',`<div class="form-field full"><span>Puntos obligatorios para esta ronda</span><div class="grid" style="gap:6px;grid-template-columns:1fr 1fr;max-height:180px;overflow:auto;border:1px solid var(--border);border-radius:8px;padding:8px">${pts.map(p=>`<label class="required-point"><input type="checkbox" name="required" value="${p.id}" ${(s?s.required.includes(p.id):true)?'checked':''}><span>${safe(p.name)}</span></label>`).join('')}</div></div>`);
 const typeInput=node.querySelector('[name="type"]');
 const meterHint=document.createElement('p');meterHint.className='readme';meterHint.textContent='Una vez durante los últimos 4 días del mes, a cualquier hora. Se completa cuando se registran todos los puntos obligatorios dentro de ese período. En el calendario aparece una sola vez: en la fecha de cumplimiento o, si sigue pendiente, en el último día del mes.';node.prepend(meterHint);
 const updateMeterFields=()=>{const monthly=typeInput.value==='meters';meterHint.hidden=!monthly;for(const name of ['turn','start','end','offset']){const input=node.querySelector('[name="'+name+'"]');input.closest('.form-field').style.display=monthly?'none':'';input.disabled=monthly}};
 typeInput.addEventListener('change',updateMeterFields);updateMeterFields();
 const form=dlg.querySelector('form');const original=form.onsubmit;form.onsubmit=e=>{if(!configurationCanWrite()){e.preventDefault();configurationRequire();return}const values=[...form.querySelectorAll('[name="required"]:checked')].map(x=>x.value);if(!values.length){e.preventDefault();toast('Elige al menos un punto obligatorio');return}const target=s;const oldSubmit=original;original.call(form,e);if(!e.defaultPrevented)return;const last=target||current('schedules').at(-1);if(last)last.required=values;save();render()};
}
function toggleIn(collection,pid){const obj=state[collection].find(x=>x.id===pid&&x.buildingId===state.activeId);if(obj){obj.active=!obj.active;save();render();toast('Estado actualizado')}}
function normalizeTimestamp(s){const raw=String(s||'').trim();let m=raw.match(/^(\d{2})[-\/.](\d{2})[-\/.](\d{4})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?/);if(m)return `${m[3]}-${m[2]}-${m[1]}T${pad(m[4])}:${m[5]}:${m[6]||'00'}`;m=raw.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/);if(m)return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]||'00'}`;return null}
function parseCSV(text){const first=text.replace(/^\uFEFF/,'').split(/\r?\n/)[0]||'',sep=(first.match(/;/g)||[]).length>(first.match(/,/g)||[]).length?';':',';const rows=[],arr=[];let cell='',inQ=false,row=[];const txt=text.replace(/^\uFEFF/,'');for(let i=0;i<txt.length;i++){const c=txt[i];if(c==='"'){if(inQ&&txt[i+1]==='"'){cell+='"';i++}else inQ=!inQ}else if(c===sep&&!inQ){row.push(cell);cell=''}else if((c==='\n'||c==='\r')&&!inQ){if(c==='\r'&&txt[i+1]==='\n')i++;row.push(cell);if(row.some(c=>c.trim()))rows.push(row);row=[];cell=''}else cell+=c}row.push(cell);if(row.some(c=>c.trim()))rows.push(row);return rows}
function importFile(file){const reader=new FileReader();reader.onload=()=>{try{const rows=parseCSV(String(reader.result));if(rows.length<2){toast('CSV sin registros');return}const headers=rows[0].map(x=>x.toLowerCase().trim()),index=names=>headers.findIndex(h=>names.some(n=>h.includes(n)));let iDate=index(['fecha','timestamp','date']),iCode=index(['código','codigo','rfid','code']),iDevice=index(['equipo','device','lector']);if(iDate<0)iDate=0;if(iCode<0)iCode=1;if(iDevice<0)iDevice=3;let added=0,duplicated=0,invalid=0;const keys=new Set(state.readings.filter(belongs).map(r=>[r.device,r.timestamp,r.code].join('|')));for(const row of rows.slice(1)){const timestamp=normalizeTimestamp(row[iDate]),code=(row[iCode]||'').trim().toUpperCase(),device=(row[iDevice]||'').trim()||'Sin identificar';if(!timestamp||!code){invalid++;continue}const key=[device,timestamp,code].join('|');if(keys.has(key)){duplicated++;continue}state.readings.push({id:id(),buildingId:state.activeId,timestamp,code,device,demo:false,source:'csv'});keys.add(key);added++}save();render();toast(`Importación: ${added} nuevos, ${duplicated} duplicados y ${invalid} inválidos`)}catch(e){toast('No se pudo leer el CSV: '+e.message)}};reader.readAsText(file,'UTF-8')}
function downloadCSV(name,rows){const esc=x=>`"${String(x??'').replace(/"/g,'""')}"`,content='\uFEFF'+rows.map(r=>r.map(esc).join(';')).join('\r\n');const blob=new Blob([content],{type:'text/csv;charset=utf-8;'});downloadBlob(name,blob)}
function downloadBlob(name,blob){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),2000)}
function reportData(){const evals=getEvaluations(filterDate),c=current('points'),people=peopleStats(evals);const calendar=[['Fecha','Día','Turno','Inicio','Fin','Responsable',...c.filter(p=>p.active).map(p=>p.name),'Puntos revisados','Puntos exigidos','Estado','Observación']];for(const e of evals)calendar.push([fmtDate(e.date),weekdays[toDate(e.date).getDay()],e.s.turn,e.window.start.slice(11,16),e.window.end.slice(11,16),employee(e.s.employeeId)?.name||'Por asignar',...c.filter(p=>p.active).map(p=>e.status==='unconfigured'?'Sin configurar':e.visits?.some(v=>v.id===p.id)?'Revisado':'No registrado'),e.count,e.total,statusLabels[e.status],(e.s.type==='meters'?'Una vez entre '+fmtDate(e.window.start.slice(0,10))+' y '+fmtDate(e.window.end.slice(0,10))+'. ':'')+(e.missing?.map(p=>p.name).join(', ')||'')]);const reads=[['Fecha y hora','Código','Punto de control','Equipo'],...current('readings').slice().sort((a,b)=>a.timestamp.localeCompare(b.timestamp)).map(r=>[fmtDT(r.timestamp),r.code,nameByCode(r.code),r.device])];const config=[['Día','Turno','Inicio','Fin','Desfase día','Conserje','Puntos obligatorios'],...current('schedules').map(s=>[dayTitle[s.type],s.turn,s.start,s.end,s.offset,employee(s.employeeId)?.name||'Por asignar',s.required.map(pid=>point(pid)?.name||pid).join(', ')]),[],['Código','Punto de control'],...c.map(p=>[p.code,p.name])];const summary=[['Conserje asignado','Asignadas','Cumplidas','Fuera de horario','Incompletas','No realizadas','Pendientes','Sin configurar','% cumplimiento'],...people.map(s=>{const n=s.ok+s.incomplete+s.outside+s.missed;return [s.name,s.n,s.ok,s.outside,s.incomplete,s.missed,s.pending,s.unconfigured,n?Number((100*s.ok/n).toFixed(1))/100:'Sin datos']})];return [['Calendario mensual',calendar],['Lecturas',reads],['Configuración',config],['Resumen por conserje',summary]]}
function exportXLSX(){if(!window.XLSX){toast('No se cargó la biblioteca de Excel; revisa tu conexión a internet');return}const wb=XLSX.utils.book_new();for(const [name,data] of reportData()){const ws=XLSX.utils.aoa_to_sheet(data);ws['!cols']=data[0].map((v,i)=>({wch:Math.min(36,Math.max(15,String(v||'').length+4))}));XLSX.utils.book_append_sheet(wb,ws,name)}XLSX.writeFile(wb,`control-rondas-${bld().name.replace(/[^a-z0-9]/gi,'-')}-${filterDate}.xlsx`);toast('Informe Excel generado')}
function dayDetails(day){const es=getEvaluations(day.slice(0,7)).filter(e=>e.date===day);const dlg=document.getElementById('modal');const node=document.getElementById('modal-content');node.innerHTML=`<h2>Rondas del ${fmtDate(day)}</h2>${es.map(e=>`<div style="padding:10px 0;border-bottom:1px solid var(--border)"><b>${safe(e.s.turn)} · ${e.s.type==='meters'?fmtDate(e.window.start.slice(0,10))+' al '+fmtDate(e.window.end.slice(0,10)):e.window.start.slice(11,16)+'–'+e.window.end.slice(11,16)}</b><p>${badge(e.status)} · ${e.count}/${e.total} puntos</p><p class="muted">${safe(employee(e.s.employeeId)?.name||'Por asignar')}</p>${e.missing?.length?`<p class="muted">Faltantes: ${e.missing.map(p=>safe(p.name)).join(', ')}</p>`:''}</div>`).join('')}<div class="modal-actions"><button class="btn" type="button" id="done-day">Cerrar</button></div>`;node.querySelector('#done-day').onclick=()=>dlg.close();dlg.showModal()}
function demo(){if(state.buildings.some(b=>b.demo)){state.activeId=state.buildings.find(b=>b.demo).id;save();render();return}const buildingId='demostracion';state.buildings.push({id:buildingId,name:'Edificio demostración',demo:true});const ps=['Sala de bombas','Grupo electrógeno','Estacionamiento -1','Sala de basura'].map((name,i)=>({id:id(),buildingId,name,code:`D0${i+1}A`,active:true}));state.points.push(...ps);const em=id();state.employees.push({id:em,buildingId,name:'Conserje de prueba',active:true});const now=dateParts().today;for(const type of ['weekday','saturday','sunday'])state.schedules.push({id:id(),buildingId,type,turn:'Mañana',start:'10:00',end:'11:15',offset:0,employeeId:em,required:ps.map(p=>p.id),active:true});const start=addDays(now,-1),t=dayType(start);for(let i=0;i<4;i++){state.readings.push({id:id(),buildingId,timestamp:`${start}T10:${pad(5+i*3)}:00`,code:ps[i].code,device:'DEMO-01',demo:true,source:'demo'})}state.activeId=buildingId;filterDate=start.slice(0,7);save();render();toast('Se creó un edificio de demostración independiente. Todos sus registros son ficticios.')}
document.addEventListener('click',e=>{
 const nav=e.target.closest('[data-route-action]');if(nav){navigate(nav.dataset.routeAction);return}
 const tabs=e.target.closest('[data-tab]');if(tabs){if(!configurationRequire())return;tab=tabs.dataset.tab;render();return}
 const action=e.target.closest('[data-action]');if(!action)return;const act=action.dataset.action,pid=action.dataset.id;
 if(/^(add|edit|toggle)-(person|point|round|building|device)$/.test(act)||act==='import'){if(typeof configurationRequire!=='function'||!configurationRequire())return}
 if(act==='add-person'||act==='edit-person')return addEditPerson(pid);
 if(act==='add-point'||act==='edit-point')return addEditPoint(pid);
 if(act==='add-round'||act==='edit-round')return addEditRound(pid);
 if(act==='add-building'||act==='edit-building')return addEditBuilding(pid);
 if(act==='add-device'||act==='edit-device')return addEditDevice(pid);
 if(act==='toggle-person')return toggleIn('employees',pid);
 if(act==='toggle-point')return toggleIn('points',pid);
 if(act==='toggle-round')return toggleIn('schedules',pid);
 if(act==='toggle-device')return toggleIn('devices',pid);
 if(act==='import')return document.getElementById('file-import').click();
 if(act==='csv-lecturas')return downloadCSV(`lecturas-${filterDate}.csv`,[['Fecha y hora','Código','Punto de control','Equipo'],...readingsFiltered().map(r=>[fmtDT(r.timestamp),r.code,nameByCode(r.code),r.device])]);
 if(act==='xlsx')return exportXLSX();
 if(act==='day-detail')return dayDetails(action.dataset.day);
 if(act==='demo')return demo();
});
document.addEventListener('change',e=>{if(e.target.id==='building-picker'){state.activeId=e.target.value;save();render()}if(e.target.id==='month-filter'){filterDate=e.target.value||dateParts().month;render()}if(e.target.id==='file-import'&&e.target.files?.[0])importFile(e.target.files[0])});
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
document.getElementById('menu-button').onclick=()=>setSidebarOpen(!document.getElementById('sidebar').classList.contains('open'));
document.getElementById('sidebar-close').onclick=()=>setSidebarOpen(false,true);
document.getElementById('sidebar-backdrop').onclick=()=>setSidebarOpen(false,true);
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&document.getElementById('sidebar').classList.contains('open'))setSidebarOpen(false,true)});
window.matchMedia('(max-width:760px)').addEventListener('change',()=>setSidebarOpen(false));
window.addEventListener('hashchange',()=>{setSidebarOpen(false);route=(location.hash||'#inicio').slice(1);render()});
route=(location.hash||'#inicio').slice(1);render();
// Interfaz estática con datos autenticados en Supabase.
