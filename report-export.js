'use strict';
const REPORT_PALETTE={inside:['FFE2F0D9','FF24552A'],outside:['FFE8DDF4','FF65358B'],missing:['FFFCE4E4','FFA12631'],pending:['FFFFF2CC','FF795B16'],na:['FFF0F2F4','FF65717B'],unconfigured:['FFF0F2F4','FF65717B']};
let reportExportBusy=false,reportExcelLoading=null;

function reportPointCell(e,p,cutoff){
 if(!e.s.required.includes(p.id))return {kind:'na',value:'',marked:0,required:0};
 if(!p.code||p.active===false||e.status==='unconfigured')return {kind:'unconfigured',value:'Sin configurar',marked:0,required:1};
 const logs=(e.logs||[]).filter(r=>r.timestamp<=cutoff&&String(r.code).toUpperCase()===p.code.toUpperCase()).slice().sort((a,b)=>a.timestamp.localeCompare(b.timestamp));
 const timely=logs.find(r=>r.timestamp>=e.window.start&&r.timestamp<=e.window.end),reading=timely||logs[0];
 if(reading)return {kind:timely?'inside':'outside',value:reading.timestamp.slice(11,16)+(timely?'':'\nFuera de Horario'),marked:1,required:1};
 return {kind:e.status==='pending'?'pending':'missing',value:e.status==='pending'?'Pendiente':'No marcó',marked:0,required:1};
}
function reportWeek(date){const d=new Date(date+'T12:00:00Z');d.setUTCDate(d.getUTCDate()-(d.getUTCDay()+6)%7);return d.toISOString().slice(0,10)}
function reportSheetName(name,used){
 const base=(String(name).replace(/[\\/?*\[\]:\u0000-\u001f]/g,' ').replace(/^'+|'+$/g,'').trim()||'Conserje').slice(0,31);
 let result=base,n=2;while(used.has(result.toLowerCase())){const suffix=' ('+n+++')';result=base.slice(0,31-suffix.length)+suffix}used.add(result.toLowerCase());return result;
}
function buildPatrolReportData({cutoff,building,employees,points,evaluations}){
 const today=cutoff.slice(0,10),month=today.slice(0,7),from=month+'-01';
 const included=evaluations.filter(e=>e.s.type==='meters'?e.window.start<=cutoff&&e.window.end>=from:e.date>=from&&e.date<=today&&(e.window.start<=cutoff||(e.logs||[]).some(r=>r.timestamp<=cutoff)));
 const regular=included.filter(e=>e.s.type!=='meters'),water=included.filter(e=>e.s.type==='meters');
 const columnsFor=evals=>{const ids=new Set(evals.flatMap(e=>e.s.required)),columns=points.filter(p=>ids.has(p.id)).map(p=>({...p}));for(const id of ids)if(!columns.some(p=>p.id===id))columns.push({id,name:'Punto sin configurar',code:'',active:false});return columns};
 const people=employees.filter(p=>p.active!==false||regular.some(e=>e.s.employeeId===p.id)).map(p=>({...p}));
 for(const e of regular)if(!people.some(p=>p.id===(e.s.employeeId||'')))people.push({id:e.s.employeeId||'',name:e.s.employeeId?'Conserje sin ficha':'Por asignar'});
 if(!people.length)people.push({id:'',name:'Por asignar'});
 const nameFor=e=>employees.find(p=>p.id===e.s.employeeId)?.name||(e.s.employeeId?'Conserje sin ficha':'Por asignar');
 const rowsFor=(evals,columns)=>evals.map(e=>{
  const monthly=e.s.type==='meters',date=monthly&&e.date>today?today:e.date,cells=columns.map(p=>reportPointCell(e,p,cutoff));
  const hours=e.s.meterRotating?'08:00 - 22:00 (según rotación)':e.window.start.slice(11,16)+' - '+e.window.end.slice(11,16);
  const windowLabel=e.s.turn+'\n'+hours+(monthly?'\nUna vez: '+e.window.start.slice(8,10)+' al '+e.window.end.slice(8,10)+' del mes':e.window.start.slice(0,10)!==e.date?'\nEjecución: '+e.window.start.slice(8,10)+'/'+e.window.start.slice(5,7):'');
  return {date,week:reportWeek(date),sort:e.window.start,windowLabel,responsible:nameFor(e),cells,marked:cells.reduce((n,c)=>n+c.marked,0),required:cells.reduce((n,c)=>n+c.required,0)};
 }).sort((a,b)=>a.date.localeCompare(b.date)||a.sort.localeCompare(b.sort)||a.windowLabel.localeCompare(b.windowLabel)||a.responsible.localeCompare(b.responsible));
 const used=new Set(['agua caliente']);
 const sheets=people.map(person=>{const evals=regular.filter(e=>(e.s.employeeId||'')===person.id),columns=columnsFor(evaluations.filter(e=>e.s.type!=='meters'&&(e.s.employeeId||'')===person.id));return {name:person.name,sheetName:reportSheetName(person.name,used),kind:'regular',points:columns,rows:rowsFor(evals,columns)}});
 const waterColumns=columnsFor(evaluations.filter(e=>e.s.type==='meters'));
 sheets.push({name:'Agua caliente',sheetName:'Agua caliente',kind:'water',points:waterColumns,rows:rowsFor(water,waterColumns)});
 return {cutoff,from,to:today,building:building.name,sheets};
}
function reportDateValue(date){return new Date(date+'T00:00:00Z')}
function reportDateText(date){return date.slice(8,10)+'/'+date.slice(5,7)+'/'+date.slice(0,4)}
function createPatrolReportWorkbook(ExcelJS,report){
 const wb=new ExcelJS.Workbook();wb.creator='Control de Rondas';wb.created=new Date(report.cutoff);wb.modified=wb.created;
 const border={top:{style:'thin',color:{argb:'FFD5DDE1'}},left:{style:'thin',color:{argb:'FFD5DDE1'}},bottom:{style:'thin',color:{argb:'FFD5DDE1'}},right:{style:'thin',color:{argb:'FFD5DDE1'}}};
 for(const person of report.sheets){
  const sheetPoints=person.points,water=person.kind==='water',baseColumns=water?3:2,n=sheetPoints.length+baseColumns+1;
  const ws=wb.addWorksheet(person.sheetName,{views:[{state:'frozen',xSplit:baseColumns,ySplit:8,showGridLines:false}],pageSetup:{orientation:'landscape',paperSize:n>12?8:9,fitToPage:true,fitToWidth:1,fitToHeight:0,margins:{left:0.25,right:0.25,top:0.4,bottom:0.4,header:0.15,footer:0.15}}});
  ws.columns=[{width:14},{width:28},...(water?[{width:25}]:[]),...sheetPoints.map(()=>({width:19})),{width:19}];
  const heading=(row,text,fill,fontSize=11)=>{
   ws.mergeCells(row,1,row,n);const cell=ws.getCell(row,1);cell.value=text;cell.font={name:'Calibri',size:fontSize,bold:row===1,color:{argb:row===1?'FFFFFFFF':'FF172E3B'}};cell.alignment={vertical:'middle',wrapText:true};
   if(fill)cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:fill}};
  };
  heading(1,water?'LECTURAS DE AGUA CALIENTE':'REPORTE MENSUAL DE RONDAS','FF102C39',16);ws.getRow(1).height=32;
  heading(2,'Edificio: '+report.building);heading(3,water?'Responsable: indicado en cada fila según su turno':'Conserje: '+person.name);heading(4,'Período: '+reportDateText(report.from)+' al '+reportDateText(report.to));
  heading(5,'Generado: '+reportDateText(report.to)+' '+report.cutoff.slice(11,16)+'. Incluye las rondas iniciadas y las marcaciones disponibles hasta ese momento.');ws.getRow(5).height=30;
  heading(6,'Verde: marcó dentro del horario. Morado: marcó fuera de horario. Rojo: no marcó. Ámbar: ronda pendiente. Gris: sin configurar. Total: marcados / exigidos.','FFF1F5F6',10);ws.getRow(6).height=32;
  const header=ws.getRow(8);header.values=['Fecha','Horario de Ronda',...(water?['Conserje responsable']:[]),...sheetPoints.map(p=>p.name),'Total\nmarcados / exigidos'];header.height=58;
  header.eachCell(cell=>{cell.font={name:'Calibri',size:10,bold:true,color:{argb:'FFFFFFFF'}};cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF244652'}};cell.border=border;cell.alignment={vertical:'middle',horizontal:'center',wrapText:true}});
  const totalRow=(label,rows,monthTotal=false)=>{
   const row=ws.addRow([label,'',...(water?['']:[]),...sheetPoints.map((_p,i)=>{const relevant=rows.reduce((n,r)=>n+r.cells[i].required,0),marked=rows.reduce((n,r)=>n+r.cells[i].marked,0);return relevant?marked+' / '+relevant:''}),rows.reduce((n,r)=>n+r.marked,0)+' / '+rows.reduce((n,r)=>n+r.required,0)]);
   ws.mergeCells(row.number,1,row.number,baseColumns);row.height=30;
   for(let i=1;i<=n;i++){const cell=row.getCell(i);cell.font={name:'Calibri',size:10,bold:true,color:{argb:monthTotal?'FFFFFFFF':'FF172E3B'}};cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:monthTotal?'FF244652':'FFE2E7EA'}};cell.alignment={horizontal:i===1?'left':'center',vertical:'middle',wrapText:true};cell.border=border}
  };
  let week=[];
  for(let i=0;i<person.rows.length;i++){
   const record=person.rows[i],row=ws.addRow([reportDateValue(record.date),record.windowLabel,...(water?[record.responsible]:[]),...record.cells.map(c=>c.value),record.marked+' / '+record.required]);row.height=record.windowLabel.split('\n').length>2?58:42;row.getCell(1).numFmt='dd/mm/yyyy';
   for(let col=1;col<=n;col++){const cell=row.getCell(col);cell.font={name:'Calibri',size:10,color:{argb:'FF172E3B'}};cell.border=border;cell.alignment={vertical:'middle',horizontal:'center',wrapText:true}}
   for(let j=0;j<record.cells.length;j++){const cell=row.getCell(j+baseColumns+1),palette=REPORT_PALETTE[record.cells[j].kind];cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:palette[0]}};cell.font={name:'Calibri',size:10,bold:record.cells[j].marked===1,color:{argb:palette[1]}}}
   row.getCell(n).font={name:'Calibri',size:11,bold:true,color:{argb:'FF172E3B'}};
   week.push(record);if(i===person.rows.length-1||person.rows[i+1].week!==record.week){totalRow('Total semanal',week);week=[]}
  }
  if(!person.rows.length){const row=ws.addRow([water?'Sin lecturas de agua caliente programadas o realizadas en el período.':'Sin rondas iniciadas para este conserje en el período.']);ws.mergeCells(row.number,1,row.number,n);row.height=30;row.getCell(1).font={name:'Calibri',size:11,color:{argb:'FF65717B'}}}
  totalRow('TOTAL DEL PERÍODO',person.rows,true);
  ws.pageSetup.printTitlesRow='1:8';ws.pageSetup.printArea='A1:'+ws.getColumn(n).letter+ws.rowCount;
  ws.headerFooter.oddFooter='&LControl de Rondas&C'+person.name.replace(/&/g,'&&')+'&RPágina &P de &N';
 }
 return wb;
}
function loadReportExcel(){
 if(window.ExcelJS)return Promise.resolve(window.ExcelJS);
 if(reportExcelLoading)return reportExcelLoading;
 reportExcelLoading=new Promise((resolve,reject)=>{
  const script=document.createElement('script');script.src='https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js';script.crossOrigin='anonymous';
  const timer=setTimeout(()=>{script.remove();reportExcelLoading=null;reject(new Error('No se pudo cargar el generador de Excel. Revisa la conexión y vuelve a intentar.'))},20000);
  script.onload=()=>{clearTimeout(timer);if(window.ExcelJS)resolve(window.ExcelJS);else{reportExcelLoading=null;reject(new Error('No se pudo iniciar el generador de Excel.'))}};
  script.onerror=()=>{clearTimeout(timer);script.remove();reportExcelLoading=null;reject(new Error('No se pudo cargar el generador de Excel. Revisa la conexión y vuelve a intentar.'))};document.head.appendChild(script);
 });return reportExcelLoading;
}
async function downloadPatrolReport(){
 if(reportExportBusy)return;reportExportBusy=true;
 const buttons=[...document.querySelectorAll('[data-action="xlsx"]')],labels=buttons.map(b=>b.textContent);buttons.forEach(b=>{b.disabled=true;b.textContent='Generando Excel…'});
 try{
  const cutoff=dtISO(new Date()),month=cutoff.slice(0,7);
  const report=buildPatrolReportData({cutoff,building:bld(),employees:current('employees'),points:current('points'),evaluations:getEvaluations(month,cutoff)});
  const ExcelJS=await loadReportExcel(),wb=createPatrolReportWorkbook(ExcelJS,report),buffer=await wb.xlsx.writeBuffer();
  const url=URL.createObjectURL(new Blob([buffer],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'})),link=document.createElement('a');link.href=url;link.download='reporte-rondas-'+report.building.replace(/[^a-z0-9]/gi,'-')+'-'+report.from+'-al-'+report.to+'.xlsx';document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);toast('Excel generado: rondas por conserje y agua caliente en una hoja aparte.');
 }catch(error){toast('No se pudo generar el Excel. '+error.message)}
 finally{reportExportBusy=false;buttons.forEach((b,i)=>{b.disabled=false;b.textContent=labels[i]})}
}
