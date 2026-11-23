using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.IO.Ports;
using System.Linq;
using System.Media;
using System.Runtime.InteropServices;
using System.Reflection;
using System.ServiceProcess;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Forms;
using Microsoft.Win32;

[assembly: AssemblyTitle("Control de Rondas - Indicador del lector")]
[assembly: AssemblyProduct("Control de Rondas")]
[assembly: AssemblyVersion("2.2.0.0")]
[assembly: AssemblyFileVersion("2.2.0.0")]

internal static class TrayProgram {
    internal static string Root=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData),"Control de Rondas");
    internal const string Site="https://danielchacanam-afk.github.io/control-rondas/#sincronizacion";
    [STAThread] static void Main(string[] args) {
        Application.EnableVisualStyles();Application.SetCompatibleTextRenderingDefault(false);
        for(int i=0;i<args.Length;i++)if(args[i]=="--data-dir"&&i+1<args.Length)Root=Path.GetFullPath(args[++i]);
        if(args.Length>=2&&args[0]=="--probe"){
            var model=new ReaderState();ReaderView view;DateTime deadline=DateTime.UtcNow.AddSeconds(45);
            do{view=TrayContext.Probe(model);if(view.Kind!="yellow")break;Thread.Sleep(1000);}while(DateTime.UtcNow<deadline);
            File.WriteAllText(Path.GetFullPath(args[1]),new JavaScriptSerializer().Serialize(new{state=view.Kind,title=view.Title,port=view.Port,last_download=ReaderState.Text(view.Status,"last_download")}));
            Environment.ExitCode=view.Kind=="green"?0:1;return;
        }
        if(args.Length>=2&&args[0]=="--render"){
            string kind=args.Length>=3?args[2]:"green";
            var view=new ReaderView(kind,kind=="green"?"Lector conectado y verificado":kind=="yellow"?"Lector detectado; comprobando":"Error de comunicación USB","La descarga y el envío funcionan sin abrir Chrome.","COM7",new Dictionary<string,object>{{"last_download",DateTimeOffset.Now.ToString("o")},{"last_upload",DateTimeOffset.Now.ToString("o")},{"pending",0},{"total",30},{"cloud_error",""}});
            using(var form=new StatusForm()){form.UpdateView(view);form.StartPosition=FormStartPosition.Manual;form.Location=new Point(-32000,-32000);form.ShowInTaskbar=false;form.Show();Application.DoEvents();using(var image=new Bitmap(form.Width,form.Height)){form.DrawToBitmap(image,new Rectangle(Point.Empty,image.Size));image.Save(Path.GetFullPath(args[1]));}}return;
        }
        bool created;
        using(var mutex=new Mutex(true,"Local\\ControlRondas.Indicador",out created)){
            if(!created){Native.PostMessage(new IntPtr(0xffff),Native.ShowMessage,IntPtr.Zero,IntPtr.Zero);return;}
            try{using(var app=new TrayContext(args.Contains("--show")))Application.Run(app);}finally{mutex.ReleaseMutex();}
        }
    }
    internal static void Open(string target){Process.Start(new ProcessStartInfo(target){UseShellExecute=true});}
}

internal static class Native {
    [DllImport("user32.dll")]internal static extern bool DestroyIcon(IntPtr handle);
    [DllImport("user32.dll",CharSet=CharSet.Unicode)]static extern uint RegisterWindowMessage(string text);
    [DllImport("user32.dll")]internal static extern bool PostMessage(IntPtr window,uint message,IntPtr w,IntPtr l);
    internal static readonly uint ShowMessage=RegisterWindowMessage("ControlRondas.Indicador.Mostrar.2.2");
}

internal sealed class MessageWindow:NativeWindow,IDisposable {
    readonly Action show;readonly Action<string> portChanged;
    internal MessageWindow(Action action,Action<string> changed){show=action;portChanged=changed;CreateHandle(new CreateParams());}
    protected override void WndProc(ref Message m){if((uint)m.Msg==Native.ShowMessage)show();
        if(m.Msg==0x219&&(m.WParam.ToInt64()==0x8000||m.WParam.ToInt64()==0x8004)&&m.LParam!=IntPtr.Zero&&Marshal.ReadInt32(m.LParam,4)==3)portChanged(Marshal.PtrToStringUni(IntPtr.Add(m.LParam,12)));
        base.WndProc(ref m);}
    public void Dispose(){DestroyHandle();}
}

internal sealed class StatusForm:Form {
    readonly Label title=new Label(),detail=new Label(),info=new Label();
    readonly Panel header=new Panel();
    internal StatusForm(){
        Text="Control de Rondas · Estado del lector";ClientSize=new Size(580,430);StartPosition=FormStartPosition.CenterScreen;FormBorderStyle=FormBorderStyle.FixedDialog;MaximizeBox=false;Font=new Font("Segoe UI",10);BackColor=Color.White;
        header.SetBounds(0,0,580,86);header.BackColor=Color.FromArgb(16,44,57);Controls.Add(header);
        title.SetBounds(22,20,535,55);title.ForeColor=Color.White;title.Font=new Font("Segoe UI",17,FontStyle.Bold);header.Controls.Add(title);
        detail.SetBounds(24,105,530,72);detail.Font=new Font("Segoe UI",11);Controls.Add(detail);
        info.SetBounds(24,185,530,160);Controls.Add(info);
        var web=new Button{Text="Ver sincronización en la web",Location=new Point(24,366),Size=new Size(240,38)};web.Click+=(s,e)=>TrayProgram.Open(TrayProgram.Site);Controls.Add(web);
        var close=new Button{Text="Ocultar",Location=new Point(432,366),Size=new Size(124,38)};close.Click+=(s,e)=>Hide();Controls.Add(close);
        FormClosing+=(s,e)=>{if(e.CloseReason==CloseReason.UserClosing){e.Cancel=true;Hide();}};
    }
    static string When(Dictionary<string,object> status,string key){DateTimeOffset value=ReaderState.Stamp(status,key);return value==DateTimeOffset.MinValue?"Sin registro":value.ToLocalTime().ToString("dd/MM/yyyy HH:mm:ss");}
    internal void UpdateView(ReaderView view){
        title.Text=view.Title;header.BackColor=view.Kind=="green"?Color.FromArgb(28,112,80):view.Kind=="yellow"?Color.FromArgb(150,106,19):Color.FromArgb(165,49,59);
        detail.Text=view.Detail;
        string cloud=ReaderState.Text(view.Status,"cloud_error");
        info.Text="Lector: JWM 5561"+(String.IsNullOrEmpty(view.Port)?"":" · "+view.Port)+"\r\nÚltima descarga: "+When(view.Status,"last_download")+"\r\nÚltimo envío confirmado: "+When(view.Status,"last_upload")+"\r\nLecturas locales: "+ReaderState.Text(view.Status,"total")+"\r\nPendientes de envío: "+ReaderState.Text(view.Status,"pending")+"\r\n\r\n"+(String.IsNullOrEmpty(cloud)?"El servicio funciona aunque cierres esta ventana y la web.":"Nube: "+cloud+". Las lecturas se conservan localmente.");
    }
}

internal sealed class TrayContext:ApplicationContext {
    readonly NotifyIcon tray=new NotifyIcon();readonly System.Windows.Forms.Timer timer=new System.Windows.Forms.Timer();
    readonly ReaderState model=new ReaderState();readonly StatusForm form=new StatusForm();readonly MessageWindow messages;
    readonly Dictionary<string,Icon> icons=new Dictionary<string,Icon>();
    readonly string preferences=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"Control de Rondas","indicador.json");
    ReaderView current;string previous=null;bool sound=true;DateTime lastNotice=DateTime.MinValue;
    internal TrayContext(bool show){
        foreach(string kind in new[]{"green","yellow","red"})icons[kind]=CreateIcon(kind);
        try{if(File.Exists(preferences))sound=new JavaScriptSerializer().Deserialize<Dictionary<string,object>>(File.ReadAllText(preferences)).ContainsKey("sound")&&Convert.ToBoolean(new JavaScriptSerializer().Deserialize<Dictionary<string,object>>(File.ReadAllText(preferences))["sound"]);}catch{}
        var menu=new ContextMenuStrip();menu.Items.Add("Ver estado del lector",null,(s,e)=>ShowStatus());menu.Items.Add("Abrir Control de Rondas",null,(s,e)=>TrayProgram.Open(TrayProgram.Site));
        menu.Items.Add("Abrir carpeta de lecturas",null,(s,e)=>{if(Directory.Exists(TrayProgram.Root))TrayProgram.Open(TrayProgram.Root);});
        var sounds=new ToolStripMenuItem("Sonido de conexión/desconexión"){Checked=sound,CheckOnClick=true};sounds.CheckedChanged+=(s,e)=>{sound=sounds.Checked;try{Directory.CreateDirectory(Path.GetDirectoryName(preferences));File.WriteAllText(preferences,"{\"sound\":"+(sound?"true":"false")+"}");}catch{}};menu.Items.Add(sounds);menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add("Cerrar indicador (el servicio sigue activo)",null,(s,e)=>ExitThread());
        tray.ContextMenuStrip=menu;tray.Icon=icons["yellow"];tray.Text="Control de Rondas: comprobando";tray.Visible=true;tray.DoubleClick+=(s,e)=>ShowStatus();tray.BalloonTipClicked+=(s,e)=>ShowStatus();
        messages=new MessageWindow(ShowStatus,port=>{if(current==null||String.IsNullOrEmpty(current.Port)||String.Equals(port,current.Port,StringComparison.OrdinalIgnoreCase)){model.Invalidate();Refresh();}});timer.Interval=1000;timer.Tick+=(s,e)=>Refresh();timer.Start();Refresh();if(show)ShowStatus();
    }
    internal static Icon CreateIcon(string kind){
        using(var image=new Bitmap(32,32))using(var g=Graphics.FromImage(image)){
            g.SmoothingMode=System.Drawing.Drawing2D.SmoothingMode.AntiAlias;g.Clear(Color.Transparent);
            Color color=kind=="green"?Color.FromArgb(32,160,95):kind=="yellow"?Color.FromArgb(241,177,42):Color.FromArgb(215,65,76);
            using(var brush=new SolidBrush(color))g.FillEllipse(brush,2,2,28,28);
            using(var pen=new Pen(Color.White,3)){if(kind=="green"){g.DrawLines(pen,new[]{new Point(9,16),new Point(14,21),new Point(23,11)});}else if(kind=="red"){g.DrawLine(pen,11,11,21,21);g.DrawLine(pen,21,11,11,21);}else{g.DrawLine(pen,16,9,16,19);g.DrawEllipse(pen,15,23,2,2);}}
            IntPtr handle=image.GetHicon();try{using(var native=Icon.FromHandle(handle))return (Icon)native.Clone();}finally{Native.DestroyIcon(handle);}
        }
    }
    static string[] Ports(){
        var live=new HashSet<string>(SerialPort.GetPortNames(),StringComparer.OrdinalIgnoreCase);var found=new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        using(var usb=Registry.LocalMachine.OpenSubKey(@"SYSTEM\CurrentControlSet\Enum\USB"))if(usb!=null)foreach(string id in usb.GetSubKeyNames())if(id.StartsWith("VID_10C4&PID_EA60",StringComparison.OrdinalIgnoreCase))
            using(var device=usb.OpenSubKey(id))if(device!=null)foreach(string instance in device.GetSubKeyNames())using(var parameters=device.OpenSubKey(instance+@"\Device Parameters"))if(parameters!=null){string port=parameters.GetValue("PortName") as string;if(port!=null&&live.Contains(port))found.Add(port);}
        return found.ToArray();
    }
    internal static ReaderView Probe(ReaderState model){
        try{
            var status=new Dictionary<string,object>();try{string path=Path.Combine(TrayProgram.Root,"estado.json");if(File.Exists(path))using(var stream=new FileStream(path,FileMode.Open,FileAccess.Read,FileShare.ReadWrite|FileShare.Delete))using(var reader=new StreamReader(stream))status=new JavaScriptSerializer().Deserialize<Dictionary<string,object>>(reader.ReadToEnd());}catch(IOException){}catch(ArgumentException){}catch(UnauthorizedAccessException){}
            bool running=false;try{using(var service=new ServiceController("ControlRondasJWM"))running=service.Status==ServiceControllerStatus.Running;}catch(InvalidOperationException){}
            return model.Evaluate(status,Ports(),running,DateTimeOffset.UtcNow);
        }catch(Exception error){return new ReaderView("red","No se pudo comprobar el lector",error is UnauthorizedAccessException?"Este usuario no tiene permiso para consultar el estado local del auxiliar.":"No se pudo consultar el USB o el servicio. Revisa la conexión del lector.","",new Dictionary<string,object>());}
    }
    void Refresh(){
        current=Probe(model);
        tray.Icon=icons[current.Kind];string tooltip="Control de Rondas: "+current.Title;tray.Text=tooltip.Length>63?tooltip.Substring(0,63):tooltip;form.UpdateView(current);
        if(current.Kind!=previous){
            // Un solo aviso por transición; el sondeo no repite sonidos cada segundo.
            bool notify=true;
            if(notify&&(current.Kind!="yellow"||(DateTime.UtcNow-lastNotice).TotalSeconds>=2)){tray.BalloonTipTitle=current.Title;tray.BalloonTipText=current.Kind=="green"?"Comunicación confirmada con el JWM 5561. Puedes revisar la última descarga con doble clic.":current.Detail;tray.BalloonTipIcon=current.Kind=="red"?ToolTipIcon.Error:ToolTipIcon.Info;tray.ShowBalloonTip(6000);lastNotice=DateTime.UtcNow;}
            if(sound&&previous!=null){if(current.Kind=="green")SystemSounds.Asterisk.Play();else if(current.Kind=="red")SystemSounds.Exclamation.Play();}
            previous=current.Kind;
        }
    }
    void ShowStatus(){if(current!=null)form.UpdateView(current);form.Show();form.WindowState=FormWindowState.Normal;form.Activate();}
    protected override void Dispose(bool disposing){if(disposing){timer.Stop();timer.Dispose();tray.Visible=false;tray.Dispose();messages.Dispose();form.Dispose();foreach(var icon in icons.Values)icon.Dispose();}base.Dispose(disposing);}
}
