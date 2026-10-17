param([Parameter(Mandatory = $true)][string]$ManagedRoot)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$rootPrefix = [IO.Path]::GetFullPath($ManagedRoot).TrimEnd('\') + '\'
$original = $false
$copy = $false
foreach ($process in @(Get-CimInstance Win32_Process -Filter "Name = 'ChatGPT.exe'")) {
    if (-not $process.ExecutablePath) { $original = $true; $copy = $true; continue }
    if ($process.ExecutablePath -match '\\WindowsApps\\OpenAI\.Codex_') { $original = $true }
    if ($process.ExecutablePath.StartsWith($rootPrefix, [StringComparison]::OrdinalIgnoreCase)) { $copy = $true }
}
[pscustomobject]@{ originalRunning = $original; copyRunning = $copy } | ConvertTo-Json -Compress
