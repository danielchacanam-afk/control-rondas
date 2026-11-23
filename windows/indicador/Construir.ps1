param([Parameter(Mandatory=$true)][string]$Destination)
$ErrorActionPreference='Stop'
New-Item -ItemType Directory -Path $Destination -Force | Out-Null
$compiler=Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
$output=Join-Path ([IO.Path]::GetFullPath($Destination)) 'ControlRondasIndicador.exe'
& $compiler /nologo /target:winexe /platform:x64 /optimize+ /codepage:65001 /reference:System.dll /reference:System.Core.dll /reference:System.Drawing.dll /reference:System.Windows.Forms.dll /reference:System.ServiceProcess.dll /reference:System.Web.Extensions.dll ("/win32manifest:"+(Join-Path $PSScriptRoot '..\installer\Setup.manifest')) ("/out:"+$output) (Join-Path $PSScriptRoot 'Estado.cs') (Join-Path $PSScriptRoot 'Indicador.cs')
if ($LASTEXITCODE -ne 0) { throw 'No se pudo construir el indicador del lector' }
Get-Item -LiteralPath $output | Select-Object Name,Length
