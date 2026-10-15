$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$packages = @(Get-AppxPackage -Name OpenAI.Codex -ErrorAction Stop)
if ($packages.Count -ne 1) { throw "Expected exactly one registered OpenAI.Codex package, found $($packages.Count)" }
$package = $packages[0]
if ($package.PackageFamilyName -ne 'OpenAI.Codex_2p2nqsd0c76g0') { throw 'Unexpected Codex package publisher' }
[pscustomobject]@{
    packageFullName = $package.PackageFullName
    packageFamilyName = $package.PackageFamilyName
    version = $package.Version.ToString()
    architecture = $package.Architecture.ToString()
    signatureKind = $package.SignatureKind.ToString()
    packageStatus = $package.Status.ToString()
    installLocation = $package.InstallLocation
} | ConvertTo-Json -Compress
