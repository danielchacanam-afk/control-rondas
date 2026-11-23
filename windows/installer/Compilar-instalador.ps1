param([Parameter(Mandatory=$true)][string]$Payload,[Parameter(Mandatory=$true)][string]$OutputFile,
  [Parameter(Mandatory=$true)][string]$BuildDirectory)
$ErrorActionPreference='Stop'
$payloadPath=(Resolve-Path -LiteralPath $Payload).Path
$hash=(Get-FileHash -LiteralPath $payloadPath -Algorithm SHA256).Hash.ToLowerInvariant()
New-Item -ItemType Directory -Path $BuildDirectory -Force | Out-Null
New-Item -ItemType Directory -Path (Split-Path $OutputFile) -Force | Out-Null
$metadata=Join-Path (Resolve-Path -LiteralPath $BuildDirectory).Path 'PackageInfo.cs'
$text='using System.Reflection; [assembly: AssemblyTitle("Instalador de Control de Rondas")] [assembly: AssemblyProduct("Control de Rondas")] [assembly: AssemblyCompany("Control de Rondas")] [assembly: AssemblyVersion("2.2.0.0")] [assembly: AssemblyFileVersion("2.2.0.0")] internal static class PackageInfo { internal const string Sha256 = "'+$hash+'"; }'
Set-Content -LiteralPath $metadata -Value $text -Encoding UTF8
$compiler=Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
$source=Join-Path $PSScriptRoot 'Setup.cs'
$manifest=Join-Path $PSScriptRoot 'Setup.manifest'
$destination=[IO.Path]::GetFullPath($OutputFile)
$compileArgs=@('/nologo','/target:winexe','/platform:x64','/optimize+','/codepage:65001',
  '/reference:System.dll','/reference:System.Core.dll','/reference:System.Drawing.dll',
  '/reference:System.Windows.Forms.dll','/reference:System.Security.dll','/reference:System.ServiceProcess.dll',
  '/reference:System.IO.Compression.dll','/reference:System.IO.Compression.FileSystem.dll',
  ('/win32manifest:'+$manifest),('/resource:'+$payloadPath+',rondas.payload'),('/out:'+$destination),$source,$metadata)
& $compiler @compileArgs
if ($LASTEXITCODE -ne 0) { throw 'No se pudo compilar el instalador' }
$sid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value
& icacls.exe $destination /inheritance:r /grant:r "*${sid}:F" '*S-1-5-18:F' '*S-1-5-32-544:F' | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'No se pudo proteger el instalador privado' }
Get-FileHash -LiteralPath $destination -Algorithm SHA256 | Select-Object Hash
