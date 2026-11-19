using System;
using System.IO;
using System.IO.Compression;
using System.Drawing;
using System.Diagnostics;
using System.Reflection;
using System.ServiceProcess;
using System.Security.AccessControl;
using System.Security.Cryptography;
using System.Security.Principal;
using System.Text;
using System.Threading.Tasks;
using System.Windows.Forms;

internal static class Package {
    internal static Stream Open() { return Assembly.GetExecutingAssembly().GetManifestResourceStream("rondas.payload"); }
    internal static void Verify() {
        using (Stream data=Open()) using (SHA256 hash=SHA256.Create()) {
            if (data==null || BitConverter.ToString(hash.ComputeHash(data)).Replace("-", "").ToLowerInvariant()!=PackageInfo.Sha256)
                throw new InvalidDataException("El instalador está incompleto o dañado. Copia nuevamente el archivo completo.");
        }
    }
    internal static void SecureDirectory(string path) {
        Directory.CreateDirectory(path);
        DirectorySecurity acl=new DirectorySecurity();
        acl.SetAccessRuleProtection(true,false);
        bool elevated=new WindowsPrincipal(WindowsIdentity.GetCurrent()).IsInRole(WindowsBuiltInRole.Administrator);
        if(elevated)acl.SetOwner(new SecurityIdentifier("S-1-5-32-544"));
        string[] users=elevated?new string[]{"S-1-5-18","S-1-5-32-544"}:new string[]{"S-1-5-18","S-1-5-32-544",WindowsIdentity.GetCurrent().User.Value};
        foreach (string sid in users)
            acl.AddAccessRule(new FileSystemAccessRule(new SecurityIdentifier(sid),FileSystemRights.FullControl,
                InheritanceFlags.ContainerInherit|InheritanceFlags.ObjectInherit,PropagationFlags.None,AccessControlType.Allow));
        new DirectoryInfo(path).SetAccessControl(acl);
    }
    internal static void Extract(string path) {
        Verify(); SecureDirectory(path);
        string root=Path.GetFullPath(path).TrimEnd(Path.DirectorySeparatorChar)+Path.DirectorySeparatorChar;
        using(Stream stream=Open()) using(ZipArchive zip=new ZipArchive(stream,ZipArchiveMode.Read)) {
            foreach(ZipArchiveEntry entry in zip.Entries) {
                string destination=Path.GetFullPath(Path.Combine(root,entry.FullName.Replace('/',Path.DirectorySeparatorChar)));
                if(!destination.StartsWith(root,StringComparison.OrdinalIgnoreCase) || (entry.ExternalAttributes>>16 & 0xF000)==0xA000)
                    throw new InvalidDataException("El paquete contiene una ruta no válida.");
                if(String.IsNullOrEmpty(entry.Name)) { Directory.CreateDirectory(destination); continue; }
                Directory.CreateDirectory(Path.GetDirectoryName(destination));
                using(Stream source=entry.Open()) using(FileStream output=new FileStream(destination,FileMode.CreateNew,FileAccess.Write)) source.CopyTo(output);
            }
        }
    }
    internal static string License() {
        using(Stream stream=Open()) using(ZipArchive zip=new ZipArchive(stream,ZipArchiveMode.Read))
        using(StreamReader text=new StreamReader(zip.GetEntry("driver/SLAB_License_Agreement_VCP_Windows.txt").Open())) return text.ReadToEnd().TrimEnd('\x1a');
    }
}

internal sealed class SetupForm:Form {
    readonly Label message=new Label(); readonly ProgressBar progress=new ProgressBar();
    readonly Button install=new Button(); readonly Button close=new Button(); readonly CheckBox accept=new CheckBox();
    readonly LinkLabel license=new LinkLabel(); readonly LinkLabel site=new LinkLabel();
    readonly Button disable=new Button();
    bool running=false; readonly bool autoInstall; readonly bool autoDisable; readonly string userSid;
    internal SetupForm(bool automatic,string sid,bool deactivate) {
        autoInstall=automatic; autoDisable=deactivate; userSid=sid;
        Text="Instalar Control de Rondas"; ClientSize=new Size(720,480); FormBorderStyle=FormBorderStyle.FixedDialog;
        MaximizeBox=false; StartPosition=FormStartPosition.CenterScreen; AutoScaleMode=AutoScaleMode.Dpi;
        Font=new Font("Segoe UI",10); BackColor=Color.White;
        Panel top=new Panel {Location=new Point(0,0),Size=new Size(720,92),BackColor=Color.FromArgb(17,47,59)};
        top.Controls.Add(new Label{Text="CONTROL DE RONDAS",Location=new Point(28,20),Size=new Size(650,30),ForeColor=Color.White,Font=new Font("Segoe UI",18,FontStyle.Bold)});
        top.Controls.Add(new Label{Text="Brown Norte  ·  Lector 5561",Location=new Point(30,56),Size=new Size(650,24),ForeColor=Color.FromArgb(130,218,210)});
        Controls.Add(top);
        Controls.Add(new Label{Text="Todo listo para el computador del lector",Location=new Point(28,114),Size=new Size(660,30),Font=new Font("Segoe UI",14,FontStyle.Bold)});
        Controls.Add(new Label{Text="Instala el programa, el controlador USB y la conexión con la nube.\r\nSe iniciará automáticamente con Windows, sin abrir la web ni instalar Python.",Location=new Point(28,155),Size=new Size(660,58)});
        Controls.Add(new Label{Text="Uso exclusivo de Brown Norte. Este instalador contiene la conexión del lector; guárdalo de forma privada.",Location=new Point(28,216),Size=new Size(660,40),ForeColor=Color.FromArgb(90,105,115),Font=new Font("Segoe UI",9)});
        accept.Text="Acepto la licencia del controlador Silicon Labs"; accept.Location=new Point(28,265); accept.Size=new Size(495,26);
        license.Text="Ver licencia"; license.Location=new Point(550,269); license.Size=new Size(130,25);
        license.LinkClicked+=(s,e)=>ShowLicense();
        accept.CheckedChanged+=(s,e)=>install.Enabled=accept.Checked&&!running;
        Controls.Add(accept); Controls.Add(license);
        progress.Location=new Point(28,310); progress.Size=new Size(664,18); Controls.Add(progress);
        message.Text="Conecta el lector después de instalar. Windows solicitará permiso de administrador.";
        message.Location=new Point(28,343); message.Size=new Size(664,60); Controls.Add(message);
        install.Text="Instalar"; install.Location=new Point(466,420); install.Size=new Size(108,36); install.BackColor=Color.FromArgb(18,123,122);
        install.ForeColor=Color.White; install.FlatStyle=FlatStyle.Flat; install.Enabled=false; install.Click+=(s,e)=>BeginInstall();
        close.Text="Cerrar"; close.Location=new Point(584,420); close.Size=new Size(108,36); close.Click+=(s,e)=>Close();
        site.Text="Abrir Control de Rondas"; site.Location=new Point(28,428); site.Size=new Size(280,26); site.Visible=false;
        site.LinkClicked+=(s,e)=>Process.Start(new ProcessStartInfo("https://danielchacanam-afk.github.io/control-rondas/#sincronizacion"){UseShellExecute=true});
        Controls.Add(site); Controls.Add(install); Controls.Add(close);
        disable.Text="Desactivar este PC";disable.Location=new Point(28,420);disable.Size=new Size(210,36);
        try{using(ServiceController service=new ServiceController("ControlRondasJWM")){ServiceControllerStatus status=service.Status;disable.Visible=true;install.Text="Reinstalar";}}catch{disable.Visible=false;}
        disable.Click+=(s,e)=>DisableHere();Controls.Add(disable);
        FormClosing+=(s,e)=>{if(running)e.Cancel=true;};
        Shown+=(s,e)=>{if(autoDisable)DisableHere();else if(autoInstall){accept.Checked=true;BeginInstall();}};
    }
    void ShowLicense() {
        using(Form dialog=new Form{Text="Licencia del controlador Silicon Labs",Size=new Size(720,520),StartPosition=FormStartPosition.CenterParent}) {
            dialog.Controls.Add(new TextBox{Multiline=true,ReadOnly=true,ScrollBars=ScrollBars.Vertical,Dock=DockStyle.Fill,Text=Package.License(),Font=new Font("Segoe UI",9)});
            dialog.ShowDialog(this);
        }
    }
    static bool IsAdmin() { return new WindowsPrincipal(WindowsIdentity.GetCurrent()).IsInRole(WindowsBuiltInRole.Administrator); }
    void UpdateMessage(int percent,string text) {
        if(InvokeRequired) { BeginInvoke(new Action<int,string>(UpdateMessage),percent,text); return; }
        progress.Value=Math.Max(0,Math.Min(100,percent)); message.Text=text;
    }
    async void BeginInstall() {
        if(running||!accept.Checked)return;
        if(!Environment.Is64BitOperatingSystem || Environment.OSVersion.Version.Major<10 || Environment.OSVersion.Version.Build<17134) {
            MessageBox.Show(this,"Se necesita Windows 10 versión 1803 o posterior, o Windows 11, de 64 bits.",Text);return;
        }
        if(!IsAdmin()) {
            try {
                Process.Start(new ProcessStartInfo(Application.ExecutablePath,"/install /usersid="+userSid){UseShellExecute=true,Verb="runas"});
                Close();
            } catch(System.ComponentModel.Win32Exception) { message.Text="Windows no autorizó la instalación. Puedes pulsar Instalar para intentarlo nuevamente."; }
            return;
        }
        running=true; install.Enabled=false; close.Enabled=false; disable.Enabled=false; accept.Enabled=false; license.Enabled=false;
        string stage=null; StringBuilder log=new StringBuilder();
        try {
            await Task.Run(()=>{
                UpdateMessage(2,"Comprobando y preparando los archivos");
                string parent=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles),"Control de Rondas Instalacion");
                Directory.CreateDirectory(parent);
                stage=Path.Combine(parent,Guid.NewGuid().ToString("N"));
                Package.Extract(stage);
                string script=Path.Combine(stage,"Instalar.ps1");
                string arguments="-NoProfile -NonInteractive -ExecutionPolicy Bypass -File \""+script+"\" -StageRoot \""+stage+"\" -UserSid \""+userSid+"\"";
                ProcessStartInfo info=new ProcessStartInfo(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System),"WindowsPowerShell\\v1.0\\powershell.exe"),arguments);
                info.UseShellExecute=false; info.CreateNoWindow=true; info.RedirectStandardOutput=true; info.RedirectStandardError=true;
                info.StandardOutputEncoding=Encoding.UTF8;info.StandardErrorEncoding=Encoding.UTF8;
                using(Process process=new Process{StartInfo=info}) {
                    process.OutputDataReceived+=(s,e)=>{if(e.Data==null)return;lock(log)log.AppendLine(e.Data);
                        if(e.Data.StartsWith("PROGRESS|")){string[] fields=e.Data.Split(new char[]{'|'},3);int value;if(fields.Length==3&&Int32.TryParse(fields[1],out value))UpdateMessage(value,fields[2]);}};
                    process.ErrorDataReceived+=(s,e)=>{if(e.Data!=null)lock(log)log.AppendLine(e.Data);};
                    process.Start();process.BeginOutputReadLine();process.BeginErrorReadLine();process.WaitForExit();
                    if(process.ExitCode!=0){string detail=null;lock(log){foreach(string line in log.ToString().Split('\n'))if(line.StartsWith("ERROR|"))detail=line.Substring(6).Trim();}
                        throw new InvalidOperationException(detail??"No se completó la instalación. Revisa C:\\ProgramData\\Control de Rondas\\instalacion.log.");}
                }
            });
            progress.Value=100;message.Text="Listo. Conecta el lector por USB y mantén este PC encendido. Las lecturas se enviarán automáticamente cuando haya internet.";
            string result=File.ReadAllText(Path.Combine(stage,"resultado.json"));
            if(System.Text.RegularExpressions.Regex.IsMatch(result,"\"rebootRequired\"\\s*:\\s*true",System.Text.RegularExpressions.RegexOptions.IgnoreCase))
                message.Text+=" Reinicia Windows para terminar de activar el controlador.";
            install.Visible=false; disable.Visible=false; site.Visible=true; close.Text="Finalizar";
        } catch(Exception error) {
            message.Text=error.Message; progress.Value=0; install.Text="Reintentar"; install.Enabled=true; accept.Enabled=true;license.Enabled=true;
            lock(log)log.AppendLine(error.ToString());
        } finally {
            try {
                string data=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData),"Control de Rondas");
                Directory.CreateDirectory(data);File.WriteAllText(Path.Combine(data,"instalacion.log"),log.ToString(),Encoding.UTF8);
            } catch { }
            if(stage!=null) {
                string expected=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles),"Control de Rondas Instalacion")+Path.DirectorySeparatorChar;
                Guid id;
                if(stage.StartsWith(expected,StringComparison.OrdinalIgnoreCase)&&Guid.TryParseExact(Path.GetFileName(stage),"N",out id))
                    try{Directory.Delete(stage,true);}catch{ }
            }
            running=false;close.Enabled=true;disable.Enabled=true;
        }
    }
    async void DisableHere() {
        if(running)return;
        if(!autoDisable&&MessageBox.Show(this,"¿Desactivar el auxiliar de este PC para trasladar el lector? Se conservarán las lecturas y la información en la nube.",Text,MessageBoxButtons.YesNo,MessageBoxIcon.Question)!=DialogResult.Yes)return;
        if(!IsAdmin()) {
            try{Process.Start(new ProcessStartInfo(Application.ExecutablePath,"/deactivate /usersid="+userSid){UseShellExecute=true,Verb="runas"});Close();}
            catch(System.ComponentModel.Win32Exception){message.Text="Windows no autorizó la desactivación. No se hicieron cambios.";}
            return;
        }
        running=true;close.Enabled=false;install.Enabled=false;disable.Enabled=false;accept.Enabled=false;
        string stage=null;
        try {
            await Task.Run(()=>{
                string parent=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles),"Control de Rondas Instalacion");
                Directory.CreateDirectory(parent);stage=Path.Combine(parent,Guid.NewGuid().ToString("N"));Package.Extract(stage);
                ProcessStartInfo info=new ProcessStartInfo(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System),"WindowsPowerShell\\v1.0\\powershell.exe"),"-NoProfile -NonInteractive -ExecutionPolicy Bypass -File \""+Path.Combine(stage,"Desactivar.ps1")+"\""){UseShellExecute=false,CreateNoWindow=true};
                using(Process process=Process.Start(info)){process.WaitForExit();if(process.ExitCode!=0)throw new InvalidOperationException("No se pudo desactivar el servicio. Las lecturas se conservaron.");}
            });
            progress.Value=100;message.Text="Este PC quedó desactivado. Copia el instalador al nuevo computador, pulsa Instalar y conecta el lector allí.";
            disable.Visible=false;install.Visible=false;close.Text="Finalizar";
        } catch(Exception error){message.Text=error.Message;}
        finally {
            if(stage!=null){string parent=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles),"Control de Rondas Instalacion")+Path.DirectorySeparatorChar;Guid id;
                if(stage.StartsWith(parent,StringComparison.OrdinalIgnoreCase)&&Guid.TryParseExact(Path.GetFileName(stage),"N",out id))try{Directory.Delete(stage,true);}catch{}}
            running=false;close.Enabled=true;disable.Enabled=true;
        }
    }
}

internal static class Program {
    [STAThread] static int Main(string[] args) {
        try {
            if(args.Length==2&&args[0]=="/extract") { Package.Extract(args[1]);return 0; }
            if(args.Length==1&&args[0]=="/verify") { Package.Verify();return 0; }
            Application.EnableVisualStyles();Application.SetCompatibleTextRenderingDefault(false);
            string sid=WindowsIdentity.GetCurrent().User.Value;
            foreach(string arg in args)if(arg.StartsWith("/usersid="))sid=arg.Substring(9);
            if(!System.Text.RegularExpressions.Regex.IsMatch(sid,"^S-[0-9-]+$"))throw new ArgumentException("Usuario no válido");
            using(SetupForm form=new SetupForm(Array.IndexOf(args,"/install")>=0,sid,Array.IndexOf(args,"/deactivate")>=0)) {
                if(args.Length==2&&args[0]=="/render") {
                    form.StartPosition=FormStartPosition.Manual;form.Location=new Point(-32000,-32000);form.ShowInTaskbar=false;form.Show();Application.DoEvents();
                    using(Bitmap bitmap=new Bitmap(form.Width,form.Height)){form.DrawToBitmap(bitmap,new Rectangle(Point.Empty,bitmap.Size));bitmap.Save(args[1],System.Drawing.Imaging.ImageFormat.Png);}form.Hide();return 0;
                }
                Application.Run(form);
            }
            return 0;
        } catch(Exception error) { Console.Error.WriteLine(error.Message);if(args.Length==0)MessageBox.Show(error.Message,"Control de Rondas");return 1; }
    }
}
