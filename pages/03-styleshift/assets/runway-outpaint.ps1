# Outpaints a photo to 16:9 through the Runway dev API, the way Give Photo's
# pipeline does for non-16:9 uploads (same model, same extension prompt, the
# photo passed inline as the tagged @photo reference). Spends Runway credits.
param(
  [string]$Src,
  [string]$Dst,
  [string]$EnvFile,
  [string]$Ratio = "1920:1080",
  [string]$Model = "gemini_image3_pro"
)
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing

# -- key from the project's .env (never echoed)
$key = (Get-Content $EnvFile | Where-Object { $_ -match '^RUNWAYML_API_SECRET=' }) -replace '^RUNWAYML_API_SECRET=', ''
$key = $key.Trim().Trim('"')
if (-not $key) { throw "RUNWAYML_API_SECRET not found in $EnvFile" }

# -- reference image as a compact JPEG data URI (<= 1568px edge, like image_data_uri)
$img = [System.Drawing.Image]::FromFile($Src)
$scale = [math]::Min(1.0, 1568.0 / [math]::Max($img.Width, $img.Height))
$w = [int]($img.Width * $scale); $h = [int]($img.Height * $scale)
$bmp = New-Object System.Drawing.Bitmap $w, $h
$g = [System.Drawing.Graphics]::FromImage($bmp); $g.InterpolationMode = 'HighQualityBicubic'; $g.DrawImage($img, 0, 0, $w, $h)
$codec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq "image/jpeg" }
$params = New-Object System.Drawing.Imaging.EncoderParameters 1
$params.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter ([System.Drawing.Imaging.Encoder]::Quality), 88L
$ms = New-Object System.IO.MemoryStream
$bmp.Save($ms, $codec, $params); $g.Dispose(); $bmp.Dispose(); $img.Dispose()
$dataUri = "data:image/jpeg;base64," + [Convert]::ToBase64String($ms.ToArray())
"reference: ${w}x${h}, $([math]::Round($ms.Length/1KB)) KB"

# -- the pipeline's content lock + extension prompt (pipeline.build_prompt, expand_to_wide)
$prompt = @"
This is an OUTPAINT, not a re-render: @photo is kept PIXEL-FOR-PIXEL at its ORIGINAL SCALE, filling the full height of the output frame exactly as it does now (the man's head near the top edge, his shoes at the bottom edge, the same crop, the same size), and ONLY new width is added at the left and right sides to reach 16:9 — more of the same wooden walls and carpeted steps. Do NOT zoom out, do NOT shrink the subject, do NOT show more stairs above or below, do NOT add a ceiling. HARD RULE — the photograph's content is IMMUTABLE: do not add, remove or invent people, objects, text or logos; nothing appears that is not in @photo and nothing disappears; no hallucinated elements of any kind. The same person, same pose, same garments, same sunglasses, chain and laptop, same stairs, carpet and walls, same camera angle, lens and lighting, same colour grade. The output frame is 16:9 widescreen, a different shape from the source photo: naturally EXTEND the existing scene beyond the photo's edges to fill the 16:9 frame — continue the same background, environment, lighting and grade seamlessly. SOLE EXCEPTION to the content rule: this edge extension, and it is strictly a PLAIN CONTINUATION of surfaces already at the edge (more of the same wall, field, floor or sky) — NO new people, faces, animals, furniture, boxes, plants, decor, fixtures, objects, text or logos of any kind. Everything from @photo itself stays exactly as it is, complete and uncropped, and the COMPOSITION IS PRESERVED: expand OUTWARD FROM THE SUBJECT, splitting the added width across BOTH the left and right edges (and added height across top and bottom) in proportion to the original composition, so the subject keeps the SAME relative position in the new frame as in @photo — never put all the new space on one side, never re-center the subject, never shift them; the frame grows around them while they stay anchored exactly where they were.
"@

$headers = @{ "Authorization" = "Bearer $key"; "X-Runway-Version" = "2024-11-06"; "Content-Type" = "application/json" }
$body = @{
  model = $Model
  promptText = $prompt.Trim()
  ratio = $Ratio
  referenceImages = @(@{ uri = $dataUri; tag = "photo" })
} | ConvertTo-Json -Depth 5 -Compress

# PowerShell 5.1 sends string bodies as Latin-1; the prompt's em dashes need UTF-8 bytes.
$bytes = [System.Text.Encoding]::UTF8.GetBytes($body)
$task = Invoke-RestMethod -Method Post -Uri "https://api.dev.runwayml.com/v1/text_to_image" -Headers $headers -Body $bytes
"task $($task.id) created"

# -- poll
$t0 = Get-Date
while ($true) {
  Start-Sleep -Seconds 3
  $cur = Invoke-RestMethod -Method Get -Uri "https://api.dev.runwayml.com/v1/tasks/$($task.id)" -Headers @{ "Authorization" = "Bearer $key"; "X-Runway-Version" = "2024-11-06" }
  $el = [int]((Get-Date) - $t0).TotalSeconds
  "  $($cur.status) · ${el}s"
  if ($cur.status -eq "SUCCEEDED") { break }
  if ($cur.status -in @("FAILED", "CANCELLED")) { throw "Runway task $($cur.status): $($cur.failure) $($cur.failureCode)" }
  if ($el -gt 600) { throw "timed out" }
}
$url = $cur.output[0]
Invoke-WebRequest -Uri $url -OutFile $Dst
$out = [System.Drawing.Image]::FromFile($Dst)
"saved $Dst ($($out.Width)x$($out.Height))"
$out.Dispose()
