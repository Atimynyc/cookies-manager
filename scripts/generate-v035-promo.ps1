param([string]$Root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path)
Add-Type -AssemblyName System.Drawing
$Out = Join-Path $Root "store-assets"
function RoundedPath($r, [float]$radius) {
  $d=$radius*2; $p=[System.Drawing.Drawing2D.GraphicsPath]::new()
  $a=[System.Drawing.RectangleF]::new($r.X,$r.Y,$d,$d)
  $p.AddArc($a,180,90); $a.X=$r.Right-$d; $p.AddArc($a,270,90)
  $a.Y=$r.Bottom-$d; $p.AddArc($a,0,90); $a.X=$r.X; $p.AddArc($a,90,90); $p.CloseFigure(); return $p
}
function FillRound($g,$r,$radius,$color) { $p=RoundedPath $r $radius; $b=[System.Drawing.SolidBrush]::new($color); try{$g.FillPath($b,$p)}finally{$b.Dispose();$p.Dispose()} }
function DrawText($g,$text,$font,$color,$rect) { $brush=New-Object System.Drawing.SolidBrush($color); try{$g.DrawString($text,$font,$brush,$rect)}finally{$brush.Dispose()} }
function NewCard($Name,$Source,$Title,$Subtitle,$Bullets,$Accent="#1967D2",$Crop=$null) {
  $canvas=[System.Drawing.Bitmap]::new(1280,800); $g=[System.Drawing.Graphics]::FromImage($canvas)
  $g.SmoothingMode='AntiAlias';$g.InterpolationMode='HighQualityBicubic';$g.PixelOffsetMode='HighQuality';$g.TextRenderingHint='ClearTypeGridFit'
  $bg=[System.Drawing.ColorTranslator]::FromHtml("#F4F7FB");$ink=[System.Drawing.ColorTranslator]::FromHtml("#17212B");$muted=[System.Drawing.ColorTranslator]::FromHtml("#536273");$accentColor=[System.Drawing.ColorTranslator]::FromHtml($Accent)
  $g.Clear($bg); $bar=[System.Drawing.SolidBrush]::new($accentColor); try{$g.FillRectangle($bar,0,0,14,800)}finally{$bar.Dispose()}
  $titleFont=New-Object System.Drawing.Font("Segoe UI",34,[System.Drawing.FontStyle]::Bold);$subFont=New-Object System.Drawing.Font("Segoe UI",18,[System.Drawing.FontStyle]::Regular);$bodyFont=New-Object System.Drawing.Font("Segoe UI",17,[System.Drawing.FontStyle]::Regular);$labelFont=New-Object System.Drawing.Font("Segoe UI",12,[System.Drawing.FontStyle]::Bold)
  try {
    DrawText $g "COOKIE CONTROLLER" $labelFont $accentColor ([System.Drawing.RectangleF]::new(76,62,430,30))
    DrawText $g $Title $titleFont $ink ([System.Drawing.RectangleF]::new(72,108,475,122))
    DrawText $g $Subtitle $subFont $muted ([System.Drawing.RectangleF]::new(74,246,480,64))
    $y=340
    foreach($b in $Bullets){ FillRound $g ([System.Drawing.RectangleF]::new(74,$y,420,52)) 12 ([System.Drawing.ColorTranslator]::FromHtml("#E8F0FE")); DrawText $g "-  $b" $bodyFont $ink ([System.Drawing.RectangleF]::new(92,$y+7,388,38)); $y+=70 }
    FillRound $g ([System.Drawing.RectangleF]::new(568,138,680,540)) 22 ([System.Drawing.Color]::FromArgb(40,63,86,108)); FillRound $g ([System.Drawing.RectangleF]::new(560,128,680,540)) 22 ([System.Drawing.Color]::White)
    $img=[System.Drawing.Image]::FromFile($Source)
    try {
      $inner=[System.Drawing.Rectangle]::new(580,158,640,480)
      $p=RoundedPath ([System.Drawing.RectangleF]$inner) 12
      try {
        $g.SetClip($p)
        if($null -eq $Crop){$base=[System.Drawing.Rectangle]::new(0,0,$img.Width,$img.Height)}else{$base=$Crop}
        $targetRatio=$inner.Width / [double]$inner.Height; $sourceRatio=$base.Width / [double]$base.Height
        if($sourceRatio -gt $targetRatio) {
          $cropHeight=$base.Height; $cropWidth=[int]($cropHeight * $targetRatio); $cropX=$base.X+[int](($base.Width-$cropWidth)/2); $cropY=$base.Y
        } else {
          $cropWidth=$base.Width; $cropHeight=[int]($cropWidth / $targetRatio); $cropX=$base.X; $cropY=$base.Y
        }
        $src=[System.Drawing.Rectangle]::new($cropX,$cropY,$cropWidth,$cropHeight)
        $g.DrawImage($img,$inner,$src,[System.Drawing.GraphicsUnit]::Pixel)
        $g.ResetClip()
      } finally {$p.Dispose()}
    } finally {$img.Dispose()}
    $canvas.Save((Join-Path $Out $Name),[System.Drawing.Imaging.ImageFormat]::Png)
  } finally {$titleFont.Dispose();$subFont.Dispose();$bodyFont.Dispose();$labelFont.Dispose();$g.Dispose();$canvas.Dispose()}
}
NewCard "cookie-controller-v035-overview-1280x800.png" (Join-Path $Root "tests\artifacts\milestone-4-popup-favorites.png") "See every site value" "Inspect cookies and storage in one focused workspace." @("Search by name, value, or domain","Edit while keeping attributes","Favorites stay at the top") "#1967D2" ([System.Drawing.Rectangle]::new(0,0,760,550))
NewCard "cookie-controller-v035-import-1280x800.png" (Join-Path $Root "tests\artifacts\milestone-4-popup-import-dialog.png") "Move data with confidence" "Preview changes before a batch import is applied." @("Quick entry or package import","Choose conflicts item by item","Review results and undo") "#1967D2" ([System.Drawing.Rectangle]::new(0,0,1100,660))
NewCard "cookie-controller-v035-history-1280x800.png" (Join-Path $Root "tests\artifacts\milestone-4-popup-history-detail.png") "Every change has a trail" "Understand what changed, then retry or undo." @("Before and after values","Per-item failures stay visible","Undo checks the target") "#1967D2" ([System.Drawing.Rectangle]::new(0,0,760,550))
NewCard "cookie-controller-v035-sidepanel-1280x800.png" (Join-Path $Root "tests\artifacts\v031-sidepanel-batch-actions.png") "Keep it beside your tab" "Use the same tools in Chrome's side panel." @("Switch Cookies, Local, Session","Batch set or delete items","Work beside the tab") "#0F8A63" ([System.Drawing.Rectangle]::new(0,0,420,800))
