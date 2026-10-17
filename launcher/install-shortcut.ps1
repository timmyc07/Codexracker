param([Parameter(Mandatory = $true)][string]$Executable)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$target = (Resolve-Path -LiteralPath $Executable).Path
$installRoot = Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'Codexracker'
New-Item -ItemType Directory -Force -Path $installRoot | Out-Null
if ((Get-Item -LiteralPath $installRoot).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Refusing redirected install directory' }
$sourceHash = (Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash
# Immutable executables allow installing an update while an older launcher is open.
# The desktop shortcut chooses the new version; shared user data is never moved.
$installed = Join-Path $installRoot ("Codexracker." + $sourceHash.Substring(0, 16).ToLowerInvariant() + '.exe')
if (Test-Path -LiteralPath $installed) {
    if ((Get-FileHash -LiteralPath $installed -Algorithm SHA256).Hash -ne $sourceHash) { throw 'Unknown modification of installed executable' }
} else {
    $staged = Join-Path $installRoot ("Codexracker." + [guid]::NewGuid().ToString('N') + '.exe')
    Copy-Item -LiteralPath $target -Destination $staged
    if ((Get-FileHash -LiteralPath $staged -Algorithm SHA256).Hash -ne $sourceHash) { throw 'Installed executable fingerprint mismatch' }
    Move-Item -LiteralPath $staged -Destination $installed -Force
}
$target = $installed
$desktop = [Environment]::GetFolderPath('DesktopDirectory')
$shortcutPath = Join-Path $desktop 'Codexracker.lnk'
if (Test-Path -LiteralPath $shortcutPath) {
    $existing = (New-Object -ComObject WScript.Shell).CreateShortcut($shortcutPath)
    if (-not $existing.Description.StartsWith('Codexracker')) { throw 'Refusing to replace an unrelated shortcut' }
}
$shortcut = (New-Object -ComObject WScript.Shell).CreateShortcut($shortcutPath)
$shortcut.TargetPath = $target
$shortcut.WorkingDirectory = [IO.Path]::GetDirectoryName($target)
$shortcut.Description = 'Codexracker - Codex Token usage tracker'
$shortcut.IconLocation = "$target,0"
$shortcut.Save()
[pscustomobject]@{ shortcut = $shortcutPath; target = $shortcut.TargetPath; sha256 = $sourceHash } | ConvertTo-Json -Compress
