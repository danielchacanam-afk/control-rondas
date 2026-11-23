param([switch]$Elevated)
$ErrorActionPreference='Stop'
$principal=New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  Start-Process powershell.exe -Verb RunAs -WindowStyle Hidden -ArgumentList ('-NoProfile -ExecutionPolicy Bypass -File "'+$PSCommandPath+'" -Elevated')
  exit
}
Add-Type -AssemblyName System.Windows.Forms
$answer=[Windows.Forms.MessageBox]::Show('Se desinstalará el auxiliar de este computador. Se conservarán las lecturas locales, la información en la nube y el controlador USB. ¿Continuar?','Desinstalar Control de Rondas',[Windows.Forms.MessageBoxButtons]::YesNo,[Windows.Forms.MessageBoxIcon]::Question)
if ($answer -ne [Windows.Forms.DialogResult]::Yes) { exit }
try {
  $root=Join-Path $env:ProgramFiles 'Control de Rondas'
  $svc=Get-CimInstance Win32_Service -Filter "Name='ControlRondasJWM'"
  if ($svc -and -not $svc.PathName.StartsWith('"'+(Join-Path $root 'ControlRondas.exe')+'"',[StringComparison]::OrdinalIgnoreCase)) { throw 'El servicio pertenece a otra instalación' }
  if ($svc) {
    Stop-Service ControlRondasJWM
    (Get-Service ControlRondasJWM).WaitForStatus('Stopped',[TimeSpan]::FromSeconds(60))
    & sc.exe delete ControlRondasJWM | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'No se pudo quitar el servicio' }
  }
  $indicator=Join-Path $root 'ControlRondasIndicador.exe'
  Get-ScheduledTask -TaskName 'ControlRondasIndicador-*' -ErrorAction SilentlyContinue | Where-Object { @($_.Actions | Where-Object { $_.Execute -eq $indicator }).Count -gt 0 } | ForEach-Object {
    Stop-ScheduledTask -TaskName $_.TaskName -ErrorAction SilentlyContinue
    Unregister-ScheduledTask -TaskName $_.TaskName -Confirm:$false
  }
  Get-CimInstance Win32_Process -Filter "name='ControlRondasIndicador.exe'" | Where-Object { $_.ExecutablePath -eq $indicator } | ForEach-Object { Stop-Process -Id $_.ProcessId -ErrorAction SilentlyContinue }
  $resolved=[IO.Path]::GetFullPath($root).TrimEnd('\')
  $expected=[IO.Path]::GetFullPath((Join-Path $env:ProgramFiles 'Control de Rondas')).TrimEnd('\')
  if ($resolved -ne $expected) { throw 'Carpeta inesperada; se conservaron los archivos' }
  if (Test-Path -LiteralPath $resolved) { Remove-Item -LiteralPath $resolved -Recurse -Force }
  $menu=Join-Path $env:ProgramData 'Microsoft\Windows\Start Menu\Programs\Control de Rondas'
  $expectedMenu=[IO.Path]::GetFullPath((Join-Path $env:ProgramData 'Microsoft\Windows\Start Menu\Programs\Control de Rondas'))
  if ([IO.Path]::GetFullPath($menu) -ne $expectedMenu) { throw 'Carpeta de accesos inesperada' }
  if (Test-Path -LiteralPath $menu) { Remove-Item -LiteralPath $menu -Recurse -Force }
  Remove-Item -LiteralPath 'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\ControlRondasJWM' -Force -ErrorAction SilentlyContinue
  [Windows.Forms.MessageBox]::Show('Auxiliar desinstalado. Las lecturas se conservaron en ProgramData y en la nube.','Control de Rondas') | Out-Null
} catch { [Windows.Forms.MessageBox]::Show($_.Exception.Message,'No se completó la desinstalación') | Out-Null; exit 1 }
