$ErrorActionPreference='Stop'
$expected=Join-Path $env:ProgramFiles 'Control de Rondas\ControlRondas.exe'
$service=Get-CimInstance Win32_Service -Filter "Name='ControlRondasJWM'"
if (-not $service -or -not $service.PathName.StartsWith('"'+$expected+'"',[StringComparison]::OrdinalIgnoreCase)) { throw 'No se encontró una instalación reconocida' }
$indicator=Join-Path $env:ProgramFiles 'Control de Rondas\ControlRondasIndicador.exe'
  Get-ScheduledTask -TaskName 'ControlRondasIndicador-*' -ErrorAction SilentlyContinue | Where-Object { @($_.Actions | Where-Object { $_.Execute -eq $indicator }).Count -gt 0 } | ForEach-Object {
    Stop-ScheduledTask -TaskName $_.TaskName -ErrorAction SilentlyContinue
    Disable-ScheduledTask -TaskName $_.TaskName | Out-Null
  }
  Get-CimInstance Win32_Process -Filter "name='ControlRondasIndicador.exe'" | Where-Object { $_.ExecutablePath -eq $indicator } | ForEach-Object { Stop-Process -Id $_.ProcessId -ErrorAction SilentlyContinue }
Stop-Service -Name ControlRondasJWM
(Get-Service ControlRondasJWM).WaitForStatus('Stopped',[TimeSpan]::FromSeconds(60))
Set-Service -Name ControlRondasJWM -StartupType Disabled
Write-Output 'Auxiliar desactivado. Las lecturas locales y la información en la nube se conservaron.'
