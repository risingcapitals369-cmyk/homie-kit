# Native tools write progress to stderr, so check exit codes instead of stopping on stderr.
$ErrorActionPreference = 'Continue'
Set-Location (Split-Path $PSScriptRoot)
function Check($what) { if ($LASTEXITCODE -ne 0) { Write-Host "`n$what failed (see above)." -ForegroundColor Red; exit 1 } }

if (-not (Test-Path .dev.vars)) { Write-Host 'Run SETUP.bat first (it creates .dev.vars).'; exit 1 }
if ((Get-Content wrangler.jsonc -Raw -Encoding UTF8) -match '"USER_NAME": "YOUR_NAME"') { Write-Host 'Run SETUP.bat first (it asks your name).'; exit 1 }
if (-not (Test-Path node_modules)) { npm install --no-audit --no-fund; Check 'npm install' }

# 1. Log in to Cloudflare (opens your browser once; free account is fine).
$who = cmd /c "npx wrangler whoami 2>&1" | Out-String
if ($who -notmatch 'associated with the email|You are logged in') { npx wrangler login; Check 'Cloudflare login' }

# 2. Create the cloud database once and write its id into wrangler.jsonc.
$cfg = Get-Content wrangler.jsonc -Raw -Encoding UTF8   # UTF8 or emoji get mangled on write-back
if ($cfg -match '"database_id": "00000000-0000-0000-0000-000000000000"') {
  $out = cmd /c "npx wrangler d1 create homie 2>&1" | Out-String
  if ($out -notmatch '([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})') {
    $out = cmd /c "npx wrangler d1 info homie --json 2>&1" | Out-String   # already exists from an earlier run
    if ($out -notmatch '([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})') { Write-Host $out; throw 'Could not get database id' }
  }
  $cfg = $cfg -replace '00000000-0000-0000-0000-000000000000', $Matches[1]
  [IO.File]::WriteAllText("$PWD\wrangler.jsonc", $cfg)
  Write-Host "Database ready: $($Matches[1])"
}
node scripts/apply-schema.mjs | Out-Null; Check 'Database setup'

# 3. Upload the code + page.
npx wrangler deploy; Check 'Deploy'

# 4. Upload your secrets (password, API keys, push keys) from .dev.vars.
$vars = @{}
foreach ($line in Get-Content .dev.vars) { if ($line -match '^(\w+)=(.+)$' -and $Matches[1] -ne 'DEV') { $vars[$Matches[1]] = $Matches[2].Trim() } }
if ($vars.APP_PASSWORD -in @($null, 'change-me', 'bones-local-test')) {
  $vars.APP_PASSWORD = Read-Host 'Pick the password you will type to open the app'
}
$tmp = Join-Path $env:TEMP 'homie-secrets.json'
[IO.File]::WriteAllText($tmp, ($vars | ConvertTo-Json -Compress))
try { npx wrangler secret bulk $tmp } finally { Remove-Item $tmp -ErrorAction SilentlyContinue }
Check 'Uploading secrets'

Write-Host ''
Write-Host 'Done. Open the workers.dev URL printed above on your phone.'
Write-Host 'iPhone: Share -> Add to Home Screen, open it from the home screen, then Settings (...) -> turn on notifications.'
