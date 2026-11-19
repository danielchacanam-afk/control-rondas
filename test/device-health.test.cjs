const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const ctx=vm.createContext({Intl,Date});
vm.runInContext(fs.readFileSync(require('node:path').join(__dirname,'../device-health.js'),'utf8'),ctx);
test('una señal antigua nunca se presenta como lector conectado',()=>{
 ctx.record={recibido_en:'2026-11-19T15:00:00Z',estado:{usb:'connected'}};
 ctx.now=Date.parse('2026-11-19T15:03:00Z');
 assert.equal(vm.runInContext('readerState(record,now)[1]',ctx),'Auxiliar sin señal reciente');
});
test('distingue desconexión USB de error de lectura con señal actual',()=>{
 ctx.record={recibido_en:'2026-11-19T15:00:00Z',estado:{usb:'disconnected'}};
 ctx.now=Date.parse('2026-11-19T15:00:30Z');
 assert.equal(vm.runInContext('readerState(record,now)[1]',ctx),'Lector USB desconectado');
 ctx.record.estado.usb='error';
 assert.equal(vm.runInContext('readerState(record,now)[1]',ctx),'Error de lectura USB');
});
test('fechas inválidas no rompen el panel',()=>{
 assert.equal(vm.runInContext("healthDate('invalida')",ctx),'Sin registro');
 assert.equal(vm.runInContext('healthDate(null)',ctx),'Sin registro');
});
