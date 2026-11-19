param([Parameter(Mandatory=$true)][string]$Resource,[Parameter(Mandatory=$true)][string]$ResultFile)
$ErrorActionPreference='Stop'
try {
  if ((Split-Path -Leaf $Resource) -ne 'codex-rejected-cas.pem') { throw 'Recurso inesperado' }
  $installRoot=Join-Path $env:ProgramFiles 'Control de Rondas'
  $target=Join-Path $installRoot '_internal\codex-rejected-cas.pem'
  $service=Get-CimInstance Win32_Service -Filter "Name='ControlRondasJWM'"
  if (-not $service -or -not $service.PathName.StartsWith('"'+(Join-Path $installRoot 'ControlRondas.exe')+'"')) { throw 'Servicio inesperado' }
  Copy-Item -LiteralPath $Resource -Destination $target -Force
  if ((Get-FileHash -LiteralPath $Resource).Hash -ne (Get-FileHash -LiteralPath $target).Hash) { throw 'El recurso no coincide con el original' }
  @{state='ok';message='Recurso TLS instalado; el servicio reintentará el envío automáticamente';time=(Get-Date).ToString('o')} | ConvertTo-Json | Set-Content -LiteralPath $ResultFile -Encoding UTF8
} catch {
  @{state='error';message=$_.Exception.Message;time=(Get-Date).ToString('o')} | ConvertTo-Json | Set-Content -LiteralPath $ResultFile -Encoding UTF8
  exit 1
}
