param(
    [string]$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
)

Add-Type -AssemblyName System.Drawing

$artifactDirectory = Join-Path $ProjectRoot "tests\artifacts"
$storeAssetDirectory = Join-Path $ProjectRoot "store-assets"

New-Item -ItemType Directory -Force -Path $storeAssetDirectory | Out-Null

function New-RoundedRectanglePath {
    param(
        [Parameter(Mandatory)]
        [System.Drawing.RectangleF]$Rectangle,

        [Parameter(Mandatory)]
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

function New-RgbBitmap {
    param(
        [Parameter(Mandatory)]
        [int]$Width,

        [Parameter(Mandatory)]
        [int]$Height
    )

    return [System.Drawing.Bitmap]::new(
        $Width,
        $Height,
        [System.Drawing.Imaging.PixelFormat]::Format24bppRgb
    )
}

function Initialize-Graphics {
    param(
        [Parameter(Mandatory)]
        [System.Drawing.Graphics]$Graphics
    )

    $Graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $Graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $Graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $Graphics.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::ClearTypeGridFit
}

function Draw-RoundedPanel {
    param(
        [Parameter(Mandatory)]
        [System.Drawing.Graphics]$Graphics,

        [Parameter(Mandatory)]
        [System.Drawing.RectangleF]$Rectangle,

        [Parameter(Mandatory)]
        [float]$Radius,

        [Parameter(Mandatory)]
        [System.Drawing.Color]$FillColor,

        [System.Drawing.Color]$BorderColor = [System.Drawing.Color]::Transparent,

        [float]$BorderWidth = 0
    )

    $path = New-RoundedRectanglePath -Rectangle $Rectangle -Radius $Radius
    $brush = [System.Drawing.SolidBrush]::new($FillColor)

    try {
        $Graphics.FillPath($brush, $path)

        if ($BorderWidth -gt 0) {
            $pen = [System.Drawing.Pen]::new($BorderColor, $BorderWidth)
            try {
                $Graphics.DrawPath($pen, $path)
            }
            finally {
                $pen.Dispose()
            }
        }
    }
    finally {
        $brush.Dispose()
        $path.Dispose()
    }
}

function Draw-ImageCrop {
    param(
        [Parameter(Mandatory)]
        [System.Drawing.Graphics]$Graphics,

        [Parameter(Mandatory)]
        [System.Drawing.Image]$Image,

        [Parameter(Mandatory)]
        [System.Drawing.Rectangle]$Destination,

        [Parameter(Mandatory)]
        [System.Drawing.Rectangle]$Source
    )

    $Graphics.DrawImage(
        $Image,
        $Destination,
        $Source.X,
        $Source.Y,
        $Source.Width,
        $Source.Height,
        [System.Drawing.GraphicsUnit]::Pixel
    )
}

function Save-Png {
    param(
        [Parameter(Mandatory)]
        [System.Drawing.Bitmap]$Bitmap,

        [Parameter(Mandatory)]
        [string]$OutputPath
    )

    $Bitmap.Save($OutputPath, [System.Drawing.Imaging.ImageFormat]::Png)
    Write-Output "Generated $OutputPath"
}

function New-StoreScreenshot {
    param(
        [Parameter(Mandatory)]
        [string]$SourcePath,

        [Parameter(Mandatory)]
        [System.Drawing.Rectangle]$SourceCrop,

        [Parameter(Mandatory)]
        [string]$OutputPath
    )

    $source = [System.Drawing.Image]::FromFile($SourcePath)
    $canvas = New-RgbBitmap -Width 1280 -Height 800
    $graphics = [System.Drawing.Graphics]::FromImage($canvas)

    try {
        Initialize-Graphics -Graphics $graphics
        $graphics.Clear([System.Drawing.ColorTranslator]::FromHtml("#EDF3F8"))

        $shadowRectangle = [System.Drawing.RectangleF]::new(118, 28, 1044, 752)
        $shellRectangle = [System.Drawing.RectangleF]::new(118, 20, 1044, 752)
        $screenRectangle = [System.Drawing.Rectangle]::new(130, 32, 1020, 728)

        Draw-RoundedPanel `
            -Graphics $graphics `
            -Rectangle $shadowRectangle `
            -Radius 24 `
            -FillColor ([System.Drawing.Color]::FromArgb(36, 63, 86, 108))
        Draw-RoundedPanel `
            -Graphics $graphics `
            -Rectangle $shellRectangle `
            -Radius 24 `
            -FillColor ([System.Drawing.Color]::White)

        $clipPath = New-RoundedRectanglePath `
            -Rectangle ([System.Drawing.RectangleF]$screenRectangle) `
            -Radius 12
        try {
            $graphics.SetClip($clipPath)
            Draw-ImageCrop `
                -Graphics $graphics `
                -Image $source `
                -Destination $screenRectangle `
                -Source $SourceCrop
            $graphics.ResetClip()
        }
        finally {
            $clipPath.Dispose()
        }

        Save-Png -Bitmap $canvas -OutputPath $OutputPath
    }
    finally {
        $graphics.Dispose()
        $canvas.Dispose()
        $source.Dispose()
    }
}

function New-SmallPromoTile {
    param(
        [Parameter(Mandatory)]
        [string]$IconPath,

        [Parameter(Mandatory)]
        [string]$OutputPath
    )

    $icon = [System.Drawing.Image]::FromFile($IconPath)
    $canvas = New-RgbBitmap -Width 440 -Height 280
    $graphics = [System.Drawing.Graphics]::FromImage($canvas)
    $titleFont = [System.Drawing.Font]::new("Segoe UI", 27, [System.Drawing.FontStyle]::Bold)
    $subtitleFont = [System.Drawing.Font]::new("Segoe UI", 12, [System.Drawing.FontStyle]::Regular)
    $titleBrush = [System.Drawing.SolidBrush]::new([System.Drawing.ColorTranslator]::FromHtml("#17212B"))
    $subtitleBrush = [System.Drawing.SolidBrush]::new([System.Drawing.ColorTranslator]::FromHtml("#51606F"))
    $accentBrush = [System.Drawing.SolidBrush]::new([System.Drawing.ColorTranslator]::FromHtml("#1967D2"))

    try {
        Initialize-Graphics -Graphics $graphics
        $graphics.Clear([System.Drawing.ColorTranslator]::FromHtml("#F4F7FB"))
        $graphics.FillRectangle($accentBrush, 0, 0, 10, 280)

        Draw-RoundedPanel `
            -Graphics $graphics `
            -Rectangle ([System.Drawing.RectangleF]::new(34, 76, 116, 116)) `
            -Radius 24 `
            -FillColor ([System.Drawing.Color]::White) `
            -BorderColor ([System.Drawing.ColorTranslator]::FromHtml("#DCE4ED")) `
            -BorderWidth 1
        $graphics.DrawImage($icon, [System.Drawing.Rectangle]::new(48, 90, 88, 88))

        $graphics.DrawString("Cookie", $titleFont, $titleBrush, 174, 67)
        $graphics.DrawString("Controller", $titleFont, $titleBrush, 174, 105)
        $graphics.DrawString("Cookies. Local. Session.", $subtitleFont, $subtitleBrush, 176, 161)

        $graphics.FillRectangle($accentBrush, 176, 199, 62, 5)
        $goldBrush = [System.Drawing.SolidBrush]::new([System.Drawing.ColorTranslator]::FromHtml("#F4B63F"))
        try {
            $graphics.FillRectangle($goldBrush, 244, 199, 24, 5)
        }
        finally {
            $goldBrush.Dispose()
        }

        Save-Png -Bitmap $canvas -OutputPath $OutputPath
    }
    finally {
        $accentBrush.Dispose()
        $subtitleBrush.Dispose()
        $titleBrush.Dispose()
        $subtitleFont.Dispose()
        $titleFont.Dispose()
        $graphics.Dispose()
        $canvas.Dispose()
        $icon.Dispose()
    }
}

function New-MarqueePromoTile {
    param(
        [Parameter(Mandatory)]
        [string]$IconPath,

        [Parameter(Mandatory)]
        [string]$ScreenshotPath,

        [Parameter(Mandatory)]
        [System.Drawing.Rectangle]$ScreenshotCrop,

        [Parameter(Mandatory)]
        [string]$OutputPath
    )

    $icon = [System.Drawing.Image]::FromFile($IconPath)
    $screenshot = [System.Drawing.Image]::FromFile($ScreenshotPath)
    $canvas = New-RgbBitmap -Width 1400 -Height 560
    $graphics = [System.Drawing.Graphics]::FromImage($canvas)
    $titleFont = [System.Drawing.Font]::new("Segoe UI", 38, [System.Drawing.FontStyle]::Bold)
    $taglineFont = [System.Drawing.Font]::new("Segoe UI", 22, [System.Drawing.FontStyle]::Regular)
    $bodyFont = [System.Drawing.Font]::new("Segoe UI", 14, [System.Drawing.FontStyle]::Regular)
    $labelFont = [System.Drawing.Font]::new("Segoe UI", 11, [System.Drawing.FontStyle]::Bold)
    $titleBrush = [System.Drawing.SolidBrush]::new([System.Drawing.ColorTranslator]::FromHtml("#17212B"))
    $bodyBrush = [System.Drawing.SolidBrush]::new([System.Drawing.ColorTranslator]::FromHtml("#51606F"))
    $accentBrush = [System.Drawing.SolidBrush]::new([System.Drawing.ColorTranslator]::FromHtml("#1967D2"))

    try {
        Initialize-Graphics -Graphics $graphics
        $graphics.Clear([System.Drawing.ColorTranslator]::FromHtml("#F4F7FB"))
        $graphics.FillRectangle($accentBrush, 0, 0, 14, 560)

        Draw-RoundedPanel `
            -Graphics $graphics `
            -Rectangle ([System.Drawing.RectangleF]::new(72, 54, 112, 112)) `
            -Radius 24 `
            -FillColor ([System.Drawing.Color]::White) `
            -BorderColor ([System.Drawing.ColorTranslator]::FromHtml("#DCE4ED")) `
            -BorderWidth 1
        $graphics.DrawImage($icon, [System.Drawing.Rectangle]::new(86, 68, 84, 84))

        $graphics.DrawString("Cookie Controller", $titleFont, $titleBrush, 70, 194)
        $graphics.DrawString("Site data, under control.", $taglineFont, $titleBrush, 72, 259)
        $graphics.DrawString("Inspect, edit, import and export cookies", $bodyFont, $bodyBrush, 74, 318)
        $graphics.DrawString("and browser storage from one focused workspace.", $bodyFont, $bodyBrush, 74, 344)

        $labels = @(
            @{ Text = "COOKIES"; X = 74; Width = 94 },
            @{ Text = "LOCAL STORAGE"; X = 178; Width = 132 },
            @{ Text = "SESSION STORAGE"; X = 320; Width = 150 }
        )
        foreach ($label in $labels) {
            Draw-RoundedPanel `
                -Graphics $graphics `
                -Rectangle ([System.Drawing.RectangleF]::new($label.X, 408, $label.Width, 36)) `
                -Radius 8 `
                -FillColor ([System.Drawing.ColorTranslator]::FromHtml("#E8F0FE"))
            $format = [System.Drawing.StringFormat]::new()
            try {
                $format.Alignment = [System.Drawing.StringAlignment]::Center
                $format.LineAlignment = [System.Drawing.StringAlignment]::Center
                $graphics.DrawString(
                    $label.Text,
                    $labelFont,
                    $accentBrush,
                    [System.Drawing.RectangleF]::new($label.X, 408, $label.Width, 36),
                    $format
                )
            }
            finally {
                $format.Dispose()
            }
        }

        $shadowRectangle = [System.Drawing.RectangleF]::new(608, 42, 728, 500)
        $shellRectangle = [System.Drawing.RectangleF]::new(608, 34, 728, 500)
        $screenRectangle = [System.Drawing.Rectangle]::new(620, 46, 704, 476)

        Draw-RoundedPanel `
            -Graphics $graphics `
            -Rectangle $shadowRectangle `
            -Radius 24 `
            -FillColor ([System.Drawing.Color]::FromArgb(38, 63, 86, 108))
        Draw-RoundedPanel `
            -Graphics $graphics `
            -Rectangle $shellRectangle `
            -Radius 24 `
            -FillColor ([System.Drawing.Color]::White)

        $clipPath = New-RoundedRectanglePath `
            -Rectangle ([System.Drawing.RectangleF]$screenRectangle) `
            -Radius 12
        try {
            $graphics.SetClip($clipPath)
            Draw-ImageCrop `
                -Graphics $graphics `
                -Image $screenshot `
                -Destination $screenRectangle `
                -Source $ScreenshotCrop
            $graphics.ResetClip()
        }
        finally {
            $clipPath.Dispose()
        }

        Save-Png -Bitmap $canvas -OutputPath $OutputPath
    }
    finally {
        $accentBrush.Dispose()
        $bodyBrush.Dispose()
        $titleBrush.Dispose()
        $labelFont.Dispose()
        $bodyFont.Dispose()
        $taglineFont.Dispose()
        $titleFont.Dispose()
        $graphics.Dispose()
        $canvas.Dispose()
        $screenshot.Dispose()
        $icon.Dispose()
    }
}

$overviewSource = Join-Path $artifactDirectory "milestone-4-popup-expiration.png"
$importSource = Join-Path $artifactDirectory "v030-package-preview.png"
$iconSource = Join-Path $ProjectRoot "assets\icon-128.png"

New-StoreScreenshot `
    -SourcePath $overviewSource `
    -SourceCrop ([System.Drawing.Rectangle]::new(0, 0, 760, 550)) `
    -OutputPath (Join-Path $storeAssetDirectory "cookie-controller-overview-v030-1280x800.png")

New-StoreScreenshot `
    -SourcePath $importSource `
    -SourceCrop ([System.Drawing.Rectangle]::new(165, 110, 770, 550)) `
    -OutputPath (Join-Path $storeAssetDirectory "cookie-controller-import-v030-1280x800.png")

New-SmallPromoTile `
    -IconPath $iconSource `
    -OutputPath (Join-Path $storeAssetDirectory "cookie-controller-small-promo-440x280.png")

New-MarqueePromoTile `
    -IconPath $iconSource `
    -ScreenshotPath $overviewSource `
    -ScreenshotCrop ([System.Drawing.Rectangle]::new(0, 0, 760, 514)) `
    -OutputPath (Join-Path $storeAssetDirectory "cookie-controller-marquee-promo-1400x560.png")
