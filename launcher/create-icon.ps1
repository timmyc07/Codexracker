param([Parameter(Mandatory = $true)][string]$Output)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$bitmap = New-Object Drawing.Bitmap 64, 64
$graphics = [Drawing.Graphics]::FromImage($bitmap)
$graphics.SmoothingMode = [Drawing.Drawing2D.SmoothingMode]::AntiAlias
$background = New-Object Drawing.SolidBrush ([Drawing.Color]::FromArgb(20, 30, 49))
$mint = New-Object Drawing.SolidBrush ([Drawing.Color]::FromArgb(76, 225, 186))
$outline = New-Object Drawing.Pen ([Drawing.Color]::FromArgb(20, 30, 49)), 3
try {
    $graphics.FillEllipse($background, 0, 0, 63, 63)
    foreach ($y in @(36, 26, 16)) {
        $graphics.FillRectangle($mint, 15, $y, 34, 10)
        $graphics.FillEllipse($mint, 15, ($y + 3), 34, 14)
        $graphics.DrawArc($outline, 15, ($y - 3), 34, 14, 0, 180)
    }
    $graphics.FillEllipse($mint, 15, 10, 34, 14)
    $icon = [Drawing.Icon]::FromHandle($bitmap.GetHicon())
    try {
        $stream = [IO.File]::Create($Output)
        try { $icon.Save($stream) } finally { $stream.Dispose() }
    } finally { $icon.Dispose() }
} finally {
    $outline.Dispose(); $mint.Dispose(); $background.Dispose(); $graphics.Dispose(); $bitmap.Dispose()
}
