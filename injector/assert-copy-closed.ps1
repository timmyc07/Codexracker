param([Parameter(Mandatory = $true)][string]$AppDirectory)

$ErrorActionPreference = 'Stop'
$copyExecutable = Join-Path ([IO.Path]::GetFullPath($AppDirectory)) 'ChatGPT.exe'
$copyProcesses = @(Get-CimInstance Win32_Process -Filter "Name = 'ChatGPT.exe'" |
    Where-Object { $_.ExecutablePath -and [string]::Equals($_.ExecutablePath, $copyExecutable, [StringComparison]::OrdinalIgnoreCase) })
if ($copyProcesses.Count -gt 0) {
    throw "Experimental copy is still running (PID $($copyProcesses.ProcessId -join ', ')); no files modified."
}
