using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;

internal sealed class ReaderView {
    internal string Kind, Title, Detail, Port;
    internal Dictionary<string,object> Status;
    internal ReaderView(string kind,string title,string detail,string port,Dictionary<string,object> status) {
        Kind=kind;Title=title;Detail=detail;Port=port;Status=status;
    }
}

// Modelo sin acceso al puerto: solo interpreta el estado producido por el servicio.
internal sealed class ReaderState {
    string signature=null;
    DateTimeOffset detectedAt;
    internal void Invalidate(){signature=null;}
    internal static string Text(Dictionary<string,object> data,string key) {
        object value;return data!=null&&data.TryGetValue(key,out value)&&value!=null?Convert.ToString(value,CultureInfo.InvariantCulture):"";
    }
    internal static DateTimeOffset Stamp(Dictionary<string,object> data,string key) {
        DateTimeOffset value;return DateTimeOffset.TryParse(Text(data,key),CultureInfo.InvariantCulture,DateTimeStyles.RoundtripKind,out value)?value:DateTimeOffset.MinValue;
    }
    internal ReaderView Evaluate(Dictionary<string,object> data,string[] ports,bool serviceRunning,DateTimeOffset now) {
        string current=String.Join(";",ports.OrderBy(p=>p,StringComparer.OrdinalIgnoreCase));
        if(current!=signature){signature=current;detectedAt=now;}
        string port=ports.Length==1?ports[0]:"";
        Func<string,string,string,ReaderView> result=(kind,title,detail)=>new ReaderView(kind,title,detail,port,data);
        if(!serviceRunning)return result("red","Auxiliar detenido","El servicio de Control de Rondas no está funcionando. La web no necesita estar abierta; el servicio sí debe estar iniciado.");
        if(ports.Length==0)return result("red","Lector desconectado","Windows no detecta el lector USB. Conecta el cable; si no aparece, prueba otro puerto USB.");
        if(ports.Length>1)return result("red","Hay más de un lector USB","Conecta solo el lector de rondas para evitar utilizar un equipo equivocado.");
        DateTimeOffset checkedAt=Stamp(data,"checked_at"),verified=Stamp(data,"verified_at");
        // Compatibilidad con el auxiliar anterior: una descarga completa también acredita comunicación.
        if(verified==DateTimeOffset.MinValue)verified=Stamp(data,"last_download");
        bool fresh=checkedAt<=now.AddSeconds(5)&&(now-checkedAt).TotalSeconds<=90;
        bool newProof=verified>=detectedAt&&verified<=now.AddSeconds(5)&&(now-verified).TotalSeconds<=90;
        string usb=Text(data,"usb");
        if(fresh&&checkedAt>=detectedAt&&usb=="error")return result("red","Error de comunicación USB",Text(data,"usb_error"));
        if(fresh&&newProof&&usb=="connected"&&String.Equals(Text(data,"port"),port,StringComparison.OrdinalIgnoreCase)&&Text(data,"mode")=="service")
            return result("green","Lector conectado y verificado","El JWM 5561 respondió correctamente. La descarga y el envío de lecturas continúan en segundo plano.");
        if((now-detectedAt).TotalSeconds>45&&(!fresh||!newProof))return result("red","No se pudo verificar el lector","El puerto USB está presente, pero no hay una respuesta reciente y confirmada del lector. Prueba reconectar el cable o usar otro puerto USB.");
        return result("yellow","Lector detectado; comprobando","Se detectó "+port+". Espera la confirmación del servicio: detectar el puerto todavía no confirma que el lector responda.");
    }
}
