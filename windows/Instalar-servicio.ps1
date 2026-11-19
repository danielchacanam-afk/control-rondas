[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)][string]$Package,
  [Parameter(Mandatory=$true)][string]$SourceData,
  [Parameter(Mandatory=$true)][string]$OriginalScript,
  [Parameter(Mandatory=$true)][string]$StartupShortcut,
  [Parameter(Mandatory=$true)][string]$UserSid,
  [Parameter(Mandatory=$true)][string]$ResultFile
)
$ErrorActionPreference = 'Stop'
$serviceName = 'ControlRondasJWM'
$installRoot = Join-Path $env:ProgramFiles 'Control de Rondas'
$dataRoot = Join-Path $env:ProgramData 'Control de Rondas'
$exe = Join-Path $installRoot 'ControlRondas.exe'
$oldProcesses = @()
$created = $false
$disabledShortcut = $false
function Native-Check([string]$Action) {
  if ($LASTEXITCODE -ne 0) { throw "$Action falló ($LASTEXITCODE)" }
}
function Result([string]$State, [string]$Message) {
  @{state=$State;message=$Message;time=(Get-Date).ToString('o');data=$dataRoot;exe=$exe} |
    ConvertTo-Json | Set-Content -LiteralPath $ResultFile -Encoding UTF8
}
try {
  $principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
  if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'Se necesita ejecutar como administrador' }
  if (Get-Service -Name $serviceName -ErrorAction SilentlyContinue) { throw 'El servicio ya existe; no se modificará una instalación existente' }
  if (-not (Test-Path -LiteralPath (Join-Path $Package 'ControlRondas.exe'))) { throw 'Falta el ejecutable probado' }
  & (Join-Path $Package 'ControlRondas.exe') --check-tls
  Native-Check 'Comprobación TLS del paquete'
  if (-not (Test-Path -LiteralPath (Join-Path $SourceData 'supabase.json'))) { throw 'Falta la configuración privada del lector' }
  if (Test-Path -LiteralPath (Join-Path $dataRoot 'lecturas.sqlite3')) { throw 'Ya existe una base de servicio; se conserva sin sobrescribir' }
  New-Item -ItemType Directory -Path $installRoot -Force | Out-Null
  New-Item -ItemType Directory -Path $dataRoot -Force | Out-Null
  & icacls.exe $dataRoot /inheritance:r /grant:r '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F' '*S-1-5-19:(OI)(CI)M' "*${UserSid}:(OI)(CI)RX" | Out-Null
  Native-Check 'Permisos de datos'
  Copy-Item -Path (Join-Path $Package '*') -Destination $installRoot -Recurse -Force
  $oldProcesses = @(Get-CimInstance Win32_Process -Filter "name='pythonw.exe'" | Where-Object { $_.CommandLine -and $_.CommandLine.Contains($OriginalScript) })
  foreach ($proc in $oldProcesses) { Stop-Process -Id $proc.ProcessId -ErrorAction Stop }
  & $exe --backup-from (Join-Path $SourceData 'lecturas.sqlite3') --data-dir $dataRoot
  Native-Check 'Copia consistente de SQLite'
  $before = (& $exe --verify --data-dir $dataRoot) | ConvertFrom-Json
  Native-Check 'Integridad de la copia'
  Copy-Item -LiteralPath (Join-Path $SourceData 'supabase.json') -Destination $dataRoot -Force
  if (Test-Path -LiteralPath (Join-Path $SourceData 'estado.json')) {
    Copy-Item -LiteralPath (Join-Path $SourceData 'estado.json') -Destination $dataRoot -Force
  }
  $command = '"' + $exe + '" --service --data-dir "' + $dataRoot + '"'
  New-Service -Name $serviceName -BinaryPathName $command -DisplayName 'Control de Rondas - Lector JWM' -StartupType Automatic |
    Out-Null
  $created = $true
  & sc.exe config $serviceName obj= 'NT AUTHORITY\LocalService' | Out-Null
  Native-Check 'Cuenta LocalService'
  & sc.exe description $serviceName 'Descarga JWM 5561 y sincroniza con Supabase sin iniciar sesión. Conserva las lecturas localmente.' | Out-Null
  Native-Check 'Descripción'
  & sc.exe failure $serviceName reset= 86400 actions= restart/10000/restart/30000/restart/60000 | Out-Null
  Native-Check 'Recuperación'
  & sc.exe failureflag $serviceName 1 | Out-Null
  Native-Check 'Recuperación ante error comunicado'
  Start-Service -Name $serviceName
  (Get-Service -Name $serviceName).WaitForStatus('Running',[TimeSpan]::FromSeconds(30))
  $deadline = (Get-Date).AddSeconds(60)
  do {
    Start-Sleep -Seconds 2
    $statusPath = Join-Path $dataRoot 'estado.json'
    if (Test-Path -LiteralPath $statusPath) {
      $health = Get-Content -LiteralPath $statusPath -Raw | ConvertFrom-Json
      if ($health.mode -eq 'service' -and $health.version -eq '2.0') { break }
    }
  } while ((Get-Date) -lt $deadline)
  if (-not $health -or $health.mode -ne 'service') { throw 'El servicio no confirmó un ciclo; se restaura el auxiliar anterior' }
  # Reinicio controlado y caída del proceso propio: prueba de recuperación SCM.
  Stop-Service -Name $serviceName
  (Get-Service -Name $serviceName).WaitForStatus('Stopped',[TimeSpan]::FromSeconds(60))
  Start-Service -Name $serviceName
  (Get-Service -Name $serviceName).WaitForStatus('Running',[TimeSpan]::FromSeconds(30))
  $probe = Get-CimInstance Win32_Service -Filter "Name='ControlRondasJWM'"
  $probeProcess = Get-CimInstance Win32_Process -Filter "ProcessId=$($probe.ProcessId)"
  if ($probeProcess.ExecutablePath -ne $exe) { throw 'No se pudo verificar el proceso de prueba' }
  Stop-Process -Id $probe.ProcessId -Force
  $deadline = (Get-Date).AddSeconds(60)
  do {
    Start-Sleep -Seconds 2
    $recovered = Get-CimInstance Win32_Service -Filter "Name='ControlRondasJWM'"
    if ($recovered.State -eq 'Running' -and $recovered.ProcessId -ne $probe.ProcessId) { break }
  } while ((Get-Date) -lt $deadline)
  if ($recovered.State -ne 'Running' -or $recovered.ProcessId -eq $probe.ProcessId) { throw 'No se confirmó la recuperación automática' }
  $after = (& $exe --verify --data-dir $dataRoot) | ConvertFrom-Json
  Native-Check 'Integridad después de la recuperación'
  if ($after.integrity -ne 'ok' -or $after.readings -lt $before.readings) { throw 'La base no pasó la comprobación posterior' }
  if (Test-Path -LiteralPath $StartupShortcut) {
    $backupShortcut = Join-Path $SourceData 'Inicio-anterior-respaldo.lnk'
    if (Test-Path -LiteralPath $backupShortcut) { throw 'Ya existe el respaldo del acceso directo; se conserva' }
    Move-Item -LiteralPath $StartupShortcut -Destination $backupShortcut
    $disabledShortcut = $true
  }
  Result 'ok' "Servicio automático LocalService. Reinicio y recuperación de caída verificados. Base íntegra: $($after.readings) lecturas."
} catch {
  $reason = $_.Exception.Message
  if ($created) {
    Stop-Service -Name $serviceName -ErrorAction SilentlyContinue
    & sc.exe delete $serviceName | Out-Null
  }
  if ($disabledShortcut) {
    Move-Item -LiteralPath (Join-Path $SourceData 'Inicio-anterior-respaldo.lnk') -Destination $StartupShortcut
  }
  foreach ($proc in $oldProcesses) {
    if ($proc.ExecutablePath) { Start-Process -FilePath $proc.ExecutablePath -ArgumentList ('"' + $OriginalScript + '"') -WindowStyle Hidden }
  }
  Result 'error' $reason
  exit 1
}
