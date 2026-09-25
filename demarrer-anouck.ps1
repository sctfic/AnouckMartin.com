# A transmettre a Anouck et a executer sur SON ordinateur Windows.
# Connexion GitHub : anouckmartin. Connexion Codex : son compte ChatGPT.
# Usage : powershell -NoProfile -ExecutionPolicy Bypass -File .\demarrer-anouck.ps1
[CmdletBinding()]
param(
    [string]$Destination = (Join-Path $env:USERPROFILE 'Dev\AnouckMartin.com')
)

$ErrorActionPreference = 'Stop'
$repoUrl = 'https://github.com/sctfic/AnouckMartin.com.git'

function Invoke-Checked {
    param([string]$Program, [string[]]$Arguments)
    & $Program @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "Echec de $Program (code $LASTEXITCODE). Corrigez le probleme indique puis relancez le script."
    }
}

function Update-SessionPath {
    $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' +
        [Environment]::GetEnvironmentVariable('Path', 'User') + ';' + $env:Path
}

function Install-IfMissing {
    param([string]$Command, [string]$Package)
    if (Get-Command $Command -ErrorAction SilentlyContinue) { return }
    if (-not (Get-Command winget.exe -ErrorAction SilentlyContinue)) {
        throw 'Installez ou mettez a jour App Installer via le Microsoft Store, puis relancez ce script.'
    }
    Write-Host "Installation de $Package..." -ForegroundColor Cyan
    Invoke-Checked 'winget.exe' @('install', '--id', $Package, '--exact', '--source', 'winget', '--accept-source-agreements', '--accept-package-agreements')
    Update-SessionPath
    if (-not (Get-Command $Command -ErrorAction SilentlyContinue)) {
        throw "Installation terminee : fermez PowerShell, rouvrez-le puis relancez ce script ($Command absent du PATH)."
    }
}

Install-IfMissing 'git.exe' 'Git.Git'
Install-IfMissing 'node.exe' 'OpenJS.NodeJS.LTS'
Install-IfMissing 'gh.exe' 'GitHub.cli'

$nodeVersion = & node.exe -p 'process.versions.node'
if ($LASTEXITCODE -ne 0 -or [int]($nodeVersion.Split('.')[0]) -lt 18) {
    throw 'Node.js 18 minimum est requis. Installez la version LTS de Node.js puis relancez.'
}

Write-Host 'Connectez-vous a GitHub avec le compte anouckmartin.' -ForegroundColor Cyan
& gh.exe auth status --hostname github.com *> $null
if ($LASTEXITCODE -ne 0) {
    Invoke-Checked 'gh.exe' @('auth', 'login', '--hostname', 'github.com', '--git-protocol', 'https', '--web')
}
$githubUser = & gh.exe api --hostname github.com user --jq '.login'
if ($LASTEXITCODE -ne 0 -or $githubUser -ne 'anouckmartin') {
    throw "Compte actif : $githubUser. Lancez 'gh auth login --hostname github.com --web' avec anouckmartin, puis relancez ce script."
}
Invoke-Checked 'gh.exe' @('auth', 'setup-git', '--hostname', 'github.com')

$Destination = [IO.Path]::GetFullPath($Destination)
$freshClone = -not (Test-Path -LiteralPath $Destination)
if ($freshClone) {
    New-Item -ItemType Directory -Path (Split-Path -Parent $Destination) -Force | Out-Null
    Invoke-Checked 'git.exe' @('clone', $repoUrl, $Destination)
} else {
    if (-not (Test-Path -LiteralPath (Join-Path $Destination '.git'))) {
        throw "Le dossier $Destination existe deja et ne contient pas le depot. Choisissez une autre -Destination."
    }
    $origin = & git.exe -C $Destination remote get-url origin
    if ($LASTEXITCODE -ne 0 -or $origin -ne $repoUrl) {
        throw "Ce dossier ne correspond pas au depot attendu : $repoUrl. Choisissez une autre -Destination."
    }
    Write-Host 'Depot deja present : conservation de la branche et des modifications locales.'
}

Set-Location -LiteralPath $Destination
Invoke-Checked 'git.exe' @('config', '--local', 'user.name', 'Anouck Martin')
Invoke-Checked 'git.exe' @('config', '--local', 'user.email', 'anouck.martin78@gmail.com')
if ($freshClone) {
    Invoke-Checked 'git.exe' @('switch', '-c', 'codex/anouck-premiers-pas')
}

# Exclusions locales : les donnees d'administration ne doivent pas etre commitees.
$excludeFile = & git.exe rev-parse --git-path info/exclude
if ($LASTEXITCODE -ne 0) { throw 'Impossible de trouver les exclusions Git locales.' }
$existingExcludes = @(Get-Content -LiteralPath $excludeFile -ErrorAction SilentlyContinue)
foreach ($entry in @('/data/', '/admin.json', '/backups/', '/node_modules/', '/logs/')) {
    if ($existingExcludes -notcontains $entry) {
        Add-Content -LiteralPath $excludeFile -Value "`n$entry"
    }
}

if (-not (Get-Command codex.cmd -ErrorAction SilentlyContinue) -and
    -not (Get-Command codex.exe -ErrorAction SilentlyContinue)) {
    Invoke-Checked 'npm.cmd' @('install', '-g', '@openai/codex')
    Update-SessionPath
}
$codexCommand = Get-Command codex.cmd,codex.exe -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $codexCommand) { throw 'Rouvrez PowerShell puis lancez codex depuis le dossier du projet.' }

Write-Host "`nProjet pret : $Destination" -ForegroundColor Green
Write-Host 'Pour voir le site, ouvrez un DEUXIEME PowerShell et executez :'
$quotedDestination = $Destination.Replace("'", "''")
Write-Host "  Set-Location -LiteralPath '$quotedDestination'"
Write-Host '  npm.cmd start'
Write-Host 'Puis ouvrez http://localhost:3210 dans votre navigateur. Ctrl+C arrete le serveur.'
Write-Host "`nCodex va demarrer. A la premiere connexion, choisissez Sign in with ChatGPT."
Write-Host 'Vous pouvez aussi ouvrir ce dossier dans votre application Codex.'
Invoke-Checked $codexCommand.Source @('Lis le README et explique-moi ce projet en francais. Ne modifie encore aucun fichier. Ensuite, aide-moi a faire ma premiere modification et a la verifier localement.')
