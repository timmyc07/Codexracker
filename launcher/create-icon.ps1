param([Parameter(Mandatory = $true)][string]$Output)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$bitmap = New-Object Drawing.Bitmap 64, 64
$graphics = [Drawing.Graphics]::FromImage($bitmap)
$graphics.SmoothingMode = [Drawing.Drawing2D.SmoothingMode]::AntiAlias
$background = New-Object Drawing.Drawing2D.LinearGradientBrush ([Drawing.Point]::new(0, 0)), ([Drawing.Point]::new(64, 64)), ([Drawing.Color]::FromArgb(249, 238, 255)), ([Drawing.Color]::FromArgb(202, 167, 232))
$ink = New-Object Drawing.SolidBrush ([Drawing.Color]::FromArgb(94, 63, 125))
$shine = New-Object Drawing.SolidBrush ([Drawing.Color]::FromArgb(180, 255, 255, 255))
$outline = New-Object Drawing.Pen ([Drawing.Color]::FromArgb(94, 63, 125)), 3
try {
    $graphics.FillEllipse($background, 0, 0, 63, 63)
    $graphics.FillEllipse($shine, 10, 5, 25, 10)
    foreach ($x in @(11, 34)) {
        $graphics.FillRectangle($ink, $x, 17, 20, 7)
        $graphics.FillRectangle($ink, ($x + 6), 22, 8, 25)
    }
    $graphics.DrawArc($outline, 12, 41, 40, 14, 10, 150)
    $icon = [Drawing.Icon]::FromHandle($bitmap.GetHicon())
    try {
        $stream = [IO.File]::Create($Output)
        try { $icon.Save($stream) } finally { $stream.Dispose() }
    } finally { $icon.Dispose() }
} finally {
    $outline.Dispose(); $shine.Dispose(); $ink.Dispose(); $background.Dispose(); $graphics.Dispose(); $bitmap.Dispose()
}
