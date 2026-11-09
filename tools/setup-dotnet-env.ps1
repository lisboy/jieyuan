# ASCII-only. Idempotent user-scope PATH/DOTNET_ROOT registration for the local dotnet SDK.
# Reversible: removes only the exact entries it added.
$ErrorActionPreference = 'Stop'
$root = 'D:\GameSoftWare\dotnet'
$exe  = Join-Path $root 'dotnet.exe'

if (-not (Test-Path $exe)) { Write-Output "FAIL: $exe not found"; exit 1 }

# DOTNET_ROOT
[Environment]::SetEnvironmentVariable('DOTNET_ROOT', $root, 'User')

# PATH (User scope only - never touch Machine scope)
$userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
if ($null -eq $userPath) { $userPath = '' }
$parts = @($userPath -split ';' | Where-Object { $_ -ne '' })
if ($parts -contains $root) {
  Write-Output 'PATH: already registered'
} else {
  $parts = @($root) + $parts
  [Environment]::SetEnvironmentVariable('Path', ($parts -join ';'), 'User')
  Write-Output 'PATH: registered'
}

Write-Output ('DOTNET_ROOT now = ' + [Environment]::GetEnvironmentVariable('DOTNET_ROOT', 'User'))
Write-Output ('PATH user head  = ' + (([Environment]::GetEnvironmentVariable('Path', 'User') -split ';')[0..2] -join ' | '))
$out = & $exe --version 2>&1 | Out-String
Write-Output ('dotnet --version = ' + $out.Trim())
