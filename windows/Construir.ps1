param([string]$Python='python',[string]$Destination=(Join-Path $PSScriptRoot '..\dist'),[string]$BuildDirectory=(Join-Path $env:TEMP 'ControlRondas-build'))
$ErrorActionPreference='Stop'
# Ejecutar con pyinstaller, pyserial y tzdata disponibles para este Python.
$sslModule=& $Python -c 'import ssl; print(ssl.__file__)'
if ($LASTEXITCODE -ne 0) { throw 'No se pudo inspeccionar el runtime de Python' }
$tlsResource=Join-Path (Split-Path $sslModule) 'codex-rejected-cas.pem'
$buildArgs=@('-m','PyInstaller','--noconfirm','--onedir','--name','ControlRondas','--distpath',$Destination,
  '--workpath',$BuildDirectory,'--specpath',$BuildDirectory,
  '--paths',$PSScriptRoot,'--collect-all','tzdata','--hidden-import','serial.tools.list_ports_windows','--hidden-import','service_host')
if (Test-Path -LiteralPath $tlsResource) { $buildArgs+=@('--add-data',($tlsResource+';.')) }
$buildArgs+=(Join-Path $PSScriptRoot 'auxiliar.py')
& $Python @buildArgs
if ($LASTEXITCODE -ne 0) { throw 'Falló la construcción del ejecutable' }
& (Join-Path $Destination 'ControlRondas\ControlRondas.exe') --check-tls
if ($LASTEXITCODE -ne 0) { throw 'El ejecutable no pasó la comprobación TLS' }

& (Join-Path $PSScriptRoot 'indicador\Construir.ps1') -Destination (Join-Path $Destination 'ControlRondas')
