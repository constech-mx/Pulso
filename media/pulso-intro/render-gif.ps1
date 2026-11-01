$ErrorActionPreference = "Stop"

Set-Location $PSScriptRoot

$ffmpegDir = Join-Path $PSScriptRoot "node_modules\ffmpeg-static"
$ffprobeDir = Join-Path $PSScriptRoot "node_modules\ffprobe-static\bin\win32\x64"
if (Test-Path $ffmpegDir) {
    $env:PATH = "$ffmpegDir;$ffprobeDir;$env:PATH"
}

npx --yes hyperframes@0.8.229 render -o pulso-intro.mp4 --quality looks

$ffmpeg = Join-Path $PSScriptRoot "node_modules\ffmpeg-static\ffmpeg.exe"
if (-not (Test-Path $ffmpeg)) {
    $ffmpeg = "ffmpeg"
}

$output = Join-Path $PSScriptRoot "..\..\docs\pulso.gif"
& $ffmpeg -y -i pulso-intro.mp4 `
    -vf "fps=12,scale=960:-1:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=256:stats_mode=diff[p];[s1][p]paletteuse=dither=bayer:bayer_scale=3" `
    -loop 0 $output

Write-Host ""
Write-Host "GIF generado en docs/pulso.gif" -ForegroundColor Green
