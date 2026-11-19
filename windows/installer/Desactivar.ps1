$ErrorActionPreference='Stop'
$expected=Join-Path $env:ProgramFiles 'Control de Rondas\ControlRondas.exe'
$service=Get-CimInstance Win32_Service -Filter "Name='ControlRondasJWM'"
if (-not $service -or -not $service.PathName.StartsWith('"'+$expected+'"',[StringComparison]::OrdinalIgnoreCase)) { throw 'No se encontró una instalación reconocida' }
Stop-Service -Name ControlRondasJWM
(Get-Service ControlRondasJWM).WaitForStatus('Stopped',[TimeSpan]::FromSeconds(60))
Set-Service -Name ControlRondasJWM -StartupType Disabled
Write-Output 'Auxiliar desactivado. Las lecturas locales y la información en la nube se conservaron.'
