$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
python (Join-Path $repoRoot "scripts/dev.py") @args
