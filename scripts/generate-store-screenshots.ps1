param(
    [string]$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
)

Add-Type -AssemblyName System.Drawing

function New-RoundedRectanglePath {
    param(
        [System.Drawing.RectangleF]$Rectangle,
        [float]$Radius
    )

    $diameter = $Radius * 2
    $path = [System.Drawing.Drawing2D.GraphicsPath]::new()
    $arc = [System.Drawing.RectangleF]::new($Rectangle.X, $Rectangle.Y, $diameter, $diameter)

    $path.AddArc($arc, 180, 90)
    $arc.X = $Rectangle.Right - $diameter
    $path.AddArc($arc, 270, 90)
    $arc.Y = $Rectangle.Bottom - $diameter
    $path.AddArc($arc, 0, 90)
    $arc.X = $Rectangle.X
    $path.AddArc($arc, 90, 90)
    $path.CloseFigure()

    return $path
}

function New-StoreScreenshot {
    param(
        [Parameter(Mandatory)]
        [string]$SourcePath,

        [Parameter(Mandatory)]
        [string]$OutputPath,

        [Parameter(Mandatory)]
        [int]$Width,

        [Parameter(Mandatory)]
        [int]$Height
    )

    $source = [System.Drawing.Image]::FromFile($SourcePath)
    $canvas = [System.Drawing.Bitmap]::new($Width, $Height)
    $graphics = [System.Drawing.Graphics]::FromImage($canvas)

    try {
        $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
        $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
        $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
        $graphics.Clear([System.Drawing.ColorTranslator]::FromHtml("#edf3f8"))

        $shellWidth = 1044
        $shellHeight = 762
        $shellX = [int](($Width - $shellWidth) / 2)
        $shellY = [int](($Height - $shellHeight) / 2)
        $shellRect = [System.Drawing.RectangleF]::new($shellX, $shellY, $shellWidth, $shellHeight)
        $shadowRect = [System.Drawing.RectangleF]::new($shellX, $shellY + 8, $shellWidth, $shellHeight)
        $innerRect = [System.Drawing.Rectangle]::new($shellX + 12, $shellY + 12, 1020, 738)
        $sourceRect = [System.Drawing.Rectangle]::new(0, 0, 760, 550)

        $shadowPath = New-RoundedRectanglePath -Rectangle $shadowRect -Radius 24
        $shellPath = New-RoundedRectanglePath -Rectangle $shellRect -Radius 24
        $innerPath = New-RoundedRectanglePath -Rectangle $innerRect -Radius 12
        $shadowBrush = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(46, 78, 99, 121))
        $shellBrush = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::White)

        try {
            $graphics.FillPath($shadowBrush, $shadowPath)
            $graphics.FillPath($shellBrush, $shellPath)
            $graphics.SetClip($innerPath)
            $graphics.DrawImage($source, $innerRect, $sourceRect, [System.Drawing.GraphicsUnit]::Pixel)
            $graphics.ResetClip()
        }
        finally {
            $shadowBrush.Dispose()
            $shellBrush.Dispose()
            $shadowPath.Dispose()
            $shellPath.Dispose()
            $innerPath.Dispose()
        }

        $canvas.Save($OutputPath, [System.Drawing.Imaging.ImageFormat]::Png)
    }
    finally {
        $graphics.Dispose()
        $canvas.Dispose()
        $source.Dispose()
    }
}

$artifactDirectory = Join-Path $ProjectRoot "tests\artifacts"
$storeAssetDirectory = Join-Path $ProjectRoot "store-assets"

$screenshots = @(
    @{
        Source = Join-Path $artifactDirectory "milestone-4-popup-expiration.png"
        Name = "cookie-controller-overview"
    },
    @{
        Source = Join-Path $artifactDirectory "milestone-4-popup-history-detail.png"
        Name = "cookie-controller-history"
    }
)

foreach ($screenshot in $screenshots) {
    New-StoreScreenshot `
        -SourcePath $screenshot.Source `
        -OutputPath (Join-Path $storeAssetDirectory "$($screenshot.Name)-1280x800.png") `
        -Width 1280 `
        -Height 800

    New-StoreScreenshot `
        -SourcePath $screenshot.Source `
        -OutputPath (Join-Path $storeAssetDirectory "$($screenshot.Name)-1280x1280.png") `
        -Width 1280 `
        -Height 1280
}

Write-Output "Generated current store screenshots in $storeAssetDirectory"
