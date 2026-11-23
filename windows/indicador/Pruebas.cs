using System;
using System.Collections.Generic;

internal static class IndicatorTests {
    static int checks=0;
    static void Expect(string expected,ReaderView view,string label){checks++;if(view.Kind!=expected)throw new Exception(label+": "+view.Kind+" != "+expected);}
    static Dictionary<string,object> Status(DateTimeOffset time){return new Dictionary<string,object>{{"usb","connected"},{"port","COM7"},{"mode","service"},{"checked_at",time.ToString("o")},{"verified_at",time.ToString("o")}};}
    static int Main(){
        try{
            var now=DateTimeOffset.Parse("2026-11-23T12:00:00Z");var model=new ReaderState();var old=Status(now.AddSeconds(-20));
            Expect("yellow",model.Evaluate(old,new[]{"COM7"},true,now),"Una conexión anterior no confirma la reconexión");
            var fresh=Status(now.AddSeconds(1));Expect("green",model.Evaluate(fresh,new[]{"COM7"},true,now.AddSeconds(1)),"Respuesta nueva verificada");
            fresh["cloud_error"]="Sin internet";Expect("green",model.Evaluate(fresh,new[]{"COM7"},true,now.AddSeconds(2)),"Internet no cambia la conexión USB");
            Expect("red",model.Evaluate(fresh,new string[0],true,now.AddSeconds(3)),"Desconexión física inmediata");
            Expect("yellow",model.Evaluate(fresh,new[]{"COM7"},true,now.AddSeconds(4)),"Reconectar el mismo COM exige otra respuesta");
            fresh=Status(now.AddSeconds(5));Expect("green",model.Evaluate(fresh,new[]{"COM7"},true,now.AddSeconds(5)),"Reconexión verificada");
            fresh["usb"]="error";fresh["usb_error"]="CRC inválido";Expect("red",model.Evaluate(fresh,new[]{"COM7"},true,now.AddSeconds(6)),"Error del protocolo");
            Expect("red",model.Evaluate(fresh,new[]{"COM7","COM8"},true,now.AddSeconds(7)),"Dos CP210x no identifican al lector");
            Expect("red",model.Evaluate(fresh,new[]{"COM7"},false,now.AddSeconds(8)),"Servicio detenido");
            var waiting=new ReaderState();Expect("yellow",waiting.Evaluate(new Dictionary<string,object>(),new[]{"COM7"},true,now),"Puerto sin respuesta inicial");
            Expect("red",waiting.Evaluate(new Dictionary<string,object>(),new[]{"COM7"},true,now.AddSeconds(46)),"Puerto sin respuesta al vencer el plazo");
            var legacy=new ReaderState();legacy.Evaluate(old,new[]{"COM7"},true,now);var previous=Status(now.AddSeconds(1));previous.Remove("verified_at");previous["last_download"]=now.AddSeconds(1).ToString("o");
            Expect("green",legacy.Evaluate(previous,new[]{"COM7"},true,now.AddSeconds(1)),"Compatibilidad con servicio 2.0");
            var stale=Status(now.AddSeconds(1));Expect("red",legacy.Evaluate(stale,new[]{"COM7"},true,now.AddSeconds(100)),"Estado vencido");
            stale["checked_at"]=now.AddSeconds(100).ToString("o");Expect("red",legacy.Evaluate(stale,new[]{"COM7"},true,now.AddSeconds(100)),"Un heartbeat no renueva una prueba USB vieja");
            var port=new ReaderState();port.Evaluate(old,new[]{"COM8"},true,now);Expect("yellow",port.Evaluate(Status(now.AddSeconds(1)),new[]{"COM8"},true,now.AddSeconds(1)),"El puerto del estado debe coincidir");
            var future=Status(now.AddHours(1));Expect("yellow",port.Evaluate(future,new[]{"COM8"},true,now.AddSeconds(2)),"Un reloj futuro no acredita conexión");
            legacy.Invalidate();Expect("yellow",legacy.Evaluate(previous,new[]{"COM7"},true,now.AddSeconds(2)),"Un evento USB requiere renovar la verificación");
            Console.WriteLine("OK: "+checks+" comprobaciones de conexión, reconexión, estado antiguo, servicio, USB y compatibilidad.");return 0;
        }catch(Exception error){Console.Error.WriteLine(error);return 1;}
    }
}
