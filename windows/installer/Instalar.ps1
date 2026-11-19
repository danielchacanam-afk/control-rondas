[CmdletBinding()]
param([Parameter(Mandatory=$true)][string]$StageRoot,[Parameter(Mandatory=$true)][string]$UserSid,
  [switch]$PrepareOnly,[string]$TestRoot)
$ErrorActionPreference='Stop'
$OutputEncoding=New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding=$OutputEncoding
$serviceName='ControlRondasJWM'
$installRoot=Join-Path $env:ProgramFiles 'Control de Rondas'
$dataRoot=Join-Path $env:ProgramData 'Control de Rondas'
if ($PrepareOnly) {
  if (-not $TestRoot) { throw 'Falta la carpeta aislada de prueba' }
  $testBase=[IO.Path]::GetFullPath($TestRoot)
  $installRoot=Join-Path $testBase 'programa'
  $dataRoot=Join-Path $testBase 'datos'
}
$package=Join-Path $StageRoot 'programa'
$exe=Join-Path $installRoot 'ControlRondas.exe'
$backup=$null
$created=$false
$oldService=$null
function Progress([int]$Percent,[string]$Text) { Write-Output ('PROGRESS|{0}|{1}' -f $Percent,$Text) }
function NativeCheck([string]$Task) { if ($LASTEXITCODE -ne 0) { throw "$Task falló ($LASTEXITCODE)" } }
function ProtectConfig([string]$Path) {
  & icacls.exe $Path /inheritance:r /grant:r '*S-1-5-18:F' '*S-1-5-32-544:F' '*S-1-5-19:R' | Out-Null
  NativeCheck 'Protección de credenciales'
  & icacls.exe $Path /setowner '*S-1-5-32-544' | Out-Null
  NativeCheck 'Propietario de credenciales'
}
function SecureFolder([string]$Path) {
  New-Item -ItemType Directory -Path $Path -Force | Out-Null
  if (-not $PrepareOnly) {
    & icacls.exe $Path /inheritance:r /grant:r '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F' '*S-1-5-19:(OI)(CI)M' "*${UserSid}:(OI)(CI)RX" | Out-Null
    NativeCheck 'Permisos de datos'
  }
}
try {
  Progress 5 'Comprobando el paquete'
  if (-not [Environment]::Is64BitOperatingSystem) { throw 'Este instalador requiere Windows de 64 bits' }
  if (-not $PrepareOnly) {
    $principal=New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
    if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'Se necesita permiso de administrador' }
  }
  & (Join-Path $package 'ControlRondas.exe') --check-tls | Out-Null
  NativeCheck 'Comprobación TLS'
  $incoming=Get-Content -LiteralPath (Join-Path $StageRoot 'conexion.json') -Raw -Encoding UTF8 | ConvertFrom-Json
  if ($incoming.url -ne 'https://mqzhxhvtfszjypwumizl.supabase.co' -or $incoming.device_token -notmatch '^[a-f0-9]{64}$') { throw 'La conexión incluida no es válida' }
  Add-Type -AssemblyName System.Security
  $configPath=Join-Path $dataRoot 'supabase.json'
  if (Test-Path -LiteralPath $configPath) {
    $existing=Get-Content -LiteralPath $configPath -Raw -Encoding UTF8 | ConvertFrom-Json
    $existingToken=$existing.device_token
    if ($existing.device_token_dpapi) {
      $existingToken=[Text.Encoding]::UTF8.GetString([Security.Cryptography.ProtectedData]::Unprotect([Convert]::FromBase64String($existing.device_token_dpapi),$null,[Security.Cryptography.DataProtectionScope]::LocalMachine))
    }
    if ($existing.url -ne $incoming.url -or $existingToken -cne $incoming.device_token) { throw 'Este PC ya tiene otra conexión configurada. Se conservó sin cambios.' }
  }
  if (-not $PrepareOnly) {
    $oldService=Get-CimInstance Win32_Service -Filter "Name='ControlRondasJWM'"
    if ($oldService -and -not $oldService.PathName.StartsWith('"'+$exe+'"',[StringComparison]::OrdinalIgnoreCase)) { throw 'Ya existe un servicio con este nombre en otra ubicación' }
  }
  SecureFolder $dataRoot
  if (-not $PrepareOnly) {
    Progress 15 'Instalando el controlador USB firmado'
    $driver=Join-Path $StageRoot 'driver\silabser.inf'
    $catalog=Join-Path $StageRoot 'driver\silabser.cat'
    if ((Get-AuthenticodeSignature -LiteralPath $catalog).Status -ne 'Valid') { throw 'Windows no pudo validar la firma del controlador USB' }
    $driverProcess=Start-Process -FilePath (Join-Path $env:WINDIR 'System32\pnputil.exe') -ArgumentList ('/add-driver "'+$driver+'" /install') -NoNewWindow -Wait -PassThru
    if ($driverProcess.ExitCode -notin @(0,3010,1641)) { throw "Windows no pudo instalar el controlador USB ($($driverProcess.ExitCode))" }
    $rebootRequired=$driverProcess.ExitCode -in @(3010,1641)
    if ($oldService) {
      Progress 30 'Respaldando la instalación existente'
      Stop-Service -Name $serviceName
      (Get-Service -Name $serviceName).WaitForStatus('Stopped',[TimeSpan]::FromSeconds(60))
      $backup=Join-Path $dataRoot ('respaldos\'+(Get-Date -Format 'yyyyMMdd-HHmmss')+'-'+[guid]::NewGuid().ToString('N'))
      New-Item -ItemType Directory -Path (Join-Path $backup 'programa') -Force | Out-Null
      Copy-Item -Path (Join-Path $installRoot '*') -Destination (Join-Path $backup 'programa') -Recurse -Force
      if (Test-Path -LiteralPath $configPath) { Copy-Item -LiteralPath $configPath -Destination (Join-Path $backup 'supabase.json'); ProtectConfig (Join-Path $backup 'supabase.json') }
      if (Test-Path -LiteralPath (Join-Path $dataRoot 'lecturas.sqlite3')) {
        & $exe --backup-from (Join-Path $dataRoot 'lecturas.sqlite3') --data-dir (Join-Path $backup 'datos') | Out-Null
        NativeCheck 'Respaldo de lecturas existentes'
      }
    }
  }
  Progress 40 'Instalando el programa completo'
  New-Item -ItemType Directory -Path $installRoot -Force | Out-Null
  Copy-Item -Path (Join-Path $package '*') -Destination $installRoot -Recurse -Force
  Progress 55 'Configurando la conexión y conservando las lecturas'
  if (-not (Test-Path -LiteralPath (Join-Path $dataRoot 'lecturas.sqlite3'))) {
    & $exe --backup-from (Join-Path $StageRoot 'datos\lecturas.sqlite3') --data-dir $dataRoot | Out-Null
    NativeCheck 'Copia de lecturas'
  }
  $verified=(& $exe --verify --data-dir $dataRoot) | ConvertFrom-Json
  NativeCheck 'Integridad de lecturas'
  if ($verified.integrity -ne 'ok') { throw 'La base de lecturas no pasó la comprobación' }
  $protected=[Security.Cryptography.ProtectedData]::Protect([Text.Encoding]::UTF8.GetBytes($incoming.device_token),$null,[Security.Cryptography.DataProtectionScope]::LocalMachine)
  @{url=$incoming.url;publishable_key=$incoming.publishable_key;device_token_dpapi=[Convert]::ToBase64String($protected);equipo=5561;edificio='brown-norte'} |
    ConvertTo-Json | Set-Content -LiteralPath $configPath -Encoding UTF8
  & $exe --check-config --data-dir $dataRoot | Out-Null
  NativeCheck 'Comprobación de conexión protegida'
  if (-not $PrepareOnly) {
    ProtectConfig $configPath
    Progress 70 'Configurando el arranque automático'
    if (-not $oldService) {
      New-Service -Name $serviceName -BinaryPathName ('"'+$exe+'" --service --data-dir "'+$dataRoot+'"') -DisplayName 'Control de Rondas - Lector JWM' -StartupType Automatic | Out-Null
      $created=$true
    }
    & sc.exe config $serviceName start= auto obj= 'NT AUTHORITY\LocalService' | Out-Null
    NativeCheck 'Cuenta del servicio'
    & sc.exe failure $serviceName reset= 86400 actions= restart/10000/restart/30000/restart/60000 | Out-Null
    NativeCheck 'Recuperación automática'
    & sc.exe failureflag $serviceName 1 | Out-Null
    NativeCheck 'Recuperación ante fallos'
    Progress 85 'Iniciando el auxiliar'
    $started=[DateTimeOffset]::UtcNow
    Start-Service -Name $serviceName
    (Get-Service -Name $serviceName).WaitForStatus('Running',[TimeSpan]::FromSeconds(30))
    $deadline=(Get-Date).AddSeconds(70)
    do {
      Start-Sleep -Seconds 2
      $statePath=Join-Path $dataRoot 'estado.json'
      if (Test-Path -LiteralPath $statePath) {
        $health=Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json
        if ($health.mode -eq 'service' -and [DateTimeOffset]::Parse($health.checked_at) -gt $started) { break }
      }
    } while ((Get-Date) -lt $deadline)
    if (-not $health -or [DateTimeOffset]::Parse($health.checked_at) -le $started) { throw 'El servicio no confirmó un ciclo de funcionamiento' }
    Progress 95 'Creando accesos y opciones de mantenimiento'
    Copy-Item -LiteralPath (Join-Path $StageRoot 'Desinstalar.ps1') -Destination $installRoot -Force
    $menu=Join-Path $env:ProgramData 'Microsoft\Windows\Start Menu\Programs\Control de Rondas'
    New-Item -ItemType Directory -Path $menu -Force | Out-Null
    Set-Content -LiteralPath (Join-Path $menu 'Abrir Control de Rondas.url') -Value "[InternetShortcut]`r`nURL=https://danielchacanam-afk.github.io/control-rondas/" -Encoding ASCII
    Set-Content -LiteralPath (Join-Path $menu 'Ver sincronización.url') -Value "[InternetShortcut]`r`nURL=https://danielchacanam-afk.github.io/control-rondas/#sincronizacion" -Encoding ASCII
    $key='HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\ControlRondasJWM'
    New-Item -Path $key -Force | Out-Null
    $uninstall='powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "'+(Join-Path $installRoot 'Desinstalar.ps1')+'"'
    @{DisplayName='Control de Rondas - Lector JWM';DisplayVersion='2.1';Publisher='Control de Rondas';InstallLocation=$installRoot;UninstallString=$uninstall;DisplayIcon=$exe} | ForEach-Object { foreach ($name in $_.Keys) { New-ItemProperty -Path $key -Name $name -Value $_[$name] -PropertyType String -Force | Out-Null } }
    New-ItemProperty -Path $key -Name NoModify -Value 1 -PropertyType DWord -Force | Out-Null
    New-ItemProperty -Path $key -Name NoRepair -Value 1 -PropertyType DWord -Force | Out-Null
  }
  Progress 100 'Instalación completada'
  @{state='ok';readings=$verified.readings;rebootRequired=[bool]$rebootRequired;preparedOnly=[bool]$PrepareOnly} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $StageRoot 'resultado.json') -Encoding UTF8
} catch {
  $reason=$_.Exception.Message
  if (-not $PrepareOnly) {
    if ($created) { Stop-Service -Name $serviceName -ErrorAction SilentlyContinue; & sc.exe delete $serviceName | Out-Null }
    elseif ($oldService) {
      Stop-Service -Name $serviceName -ErrorAction SilentlyContinue
      if ($backup) {
        Copy-Item -Path (Join-Path $backup 'programa\*') -Destination $installRoot -Recurse -Force
        if (Test-Path -LiteralPath (Join-Path $backup 'supabase.json')) { Copy-Item -LiteralPath (Join-Path $backup 'supabase.json') -Destination $configPath -Force }
      }
      $previousStart=if($oldService.StartMode -eq 'Disabled'){'Disabled'}elseif($oldService.StartMode -eq 'Manual'){'Manual'}else{'Automatic'}
      Set-Service -Name $serviceName -StartupType $previousStart -ErrorAction SilentlyContinue
      if ($oldService.State -eq 'Running') { Start-Service -Name $serviceName -ErrorAction SilentlyContinue }
    }
  }
  @{state='error';message=$reason} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $StageRoot 'resultado.json') -Encoding UTF8
  Write-Output ('ERROR|'+$reason)
  exit 1
}
