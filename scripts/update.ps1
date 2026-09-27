# Update (runs only when someone runs it: UPDATE.bat). Checks the published kit for
# a newer VERSION. If there is one, it downloads it, keeps this install's own
# settings (.dev.vars, database id, name, time zone), and redeploys. If anything
# fails, the version already online keeps running. Log: update.log in this folder.
param([switch]$NoDeploy, [string]$Repo = 'risingcapitals369-cmyk/homie-kit')
$ErrorActionPreference = 'Continue'
$root = Split-Path $PSScriptRoot
Set-Location $root
$log = Join-Path $root 'update.log'
function L($m) { Write-Host $m; try { "$(Get-Date -Format s)  $m" | Add-Content -Path $log -Encoding UTF8 } catch {} }

$local = if (Test-Path VERSION) { (Get-Content VERSION -TotalCount 1).Trim() } else { '0' }
try { $remote = (Invoke-WebRequest "https://raw.githubusercontent.com/$Repo/main/VERSION" -UseBasicParsing -TimeoutSec 30).Content.Trim() }
catch { L "check failed (offline?): $($_.Exception.Message)"; exit 0 }
if (-not ($remote -match '^\d') -or $remote -le $local) { L "already up to date ($local)"; exit 0 }
L "update available: $local -> $remote"

# Deploying needs the Cloudflare login on this PC; check before touching any files.
if (-not $NoDeploy) {
  $who = cmd /c "npx wrangler whoami 2>&1" | Out-String
  if ($who -notmatch 'associated with the email|You are logged in') { L 'not logged in to Cloudflare (run DEPLOY.bat once); skipped'; exit 0 }
}

$tmp = Join-Path $env:TEMP 'homie-update'
Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory $tmp | Out-Null
try {
  Invoke-WebRequest "https://github.com/$Repo/archive/refs/heads/main.zip" -OutFile "$tmp\u.zip" -UseBasicParsing -TimeoutSec 120
  Expand-Archive "$tmp\u.zip" $tmp -Force
} catch { L "download failed: $($_.Exception.Message)"; exit 0 }
$src = (Get-ChildItem $tmp -Directory | Select-Object -First 1).FullName

# This install's own settings carry over into the new wrangler.jsonc.
$old = Get-Content wrangler.jsonc -Raw -Encoding UTF8
$new = Get-Content "$src\wrangler.jsonc" -Raw -Encoding UTF8
foreach ($k in 'database_id', 'USER_NAME', 'TIMEZONE', 'FRIEND_NAME') {
  if ($old -match "`"$k`": `"([^`"]*)`"") { $v = $Matches[1]; $new = [regex]::Replace($new, "`"$k`": `"[^`"]*`"", "`"$k`": `"$v`"") }
}

# Copy the new code over this one (never .dev.vars, wrangler.jsonc, VERSION or local folders).
robocopy $src $root /E /NFL /NDL /NJH /NJS /NP /XF .dev.vars wrangler.jsonc VERSION update.log /XD node_modules .wrangler .git | Out-Null
if ($LASTEXITCODE -ge 8) { L "copy failed (robocopy $LASTEXITCODE)"; exit 0 }
[IO.File]::WriteAllText((Join-Path $root 'wrangler.jsonc'), $new)

if (-not $NoDeploy) {
  cmd /c "npm install --no-audit --no-fund 2>&1" | Out-Null
  $out = powershell -NoProfile -ExecutionPolicy Bypass -File scripts\deploy.ps1 2>&1 | Out-String
  if ($LASTEXITCODE -ne 0 -or $out -match 'failed \(see above\)') { L "deploy failed; the old version stays online. Output tail: $($out.Substring([Math]::Max(0, $out.Length - 400)))"; exit 0 }
}
Set-Content VERSION $remote -Encoding ASCII
L "updated to $remote$(if ($NoDeploy) { ' (files only, -NoDeploy)' } else { ' and deployed' })"
