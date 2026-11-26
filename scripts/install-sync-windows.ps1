# Installe la synchro des mails Orange vers l'admin sur ce PC : dependances, variables, tache horaire.
# Lancer une seule fois : powershell -ExecutionPolicy Bypass -File scripts\install-sync-windows.ps1

$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$syncScript = Join-Path $repo 'scripts\sync-orange-mails.py'

$pythonCmd = Get-Command python -ErrorAction SilentlyContinue
if (-not $pythonCmd) {
    throw 'Python introuvable. Installe-le avec : winget install Python.Python.3.12 , puis rouvre PowerShell.'
}
$python = $pythonCmd.Source
& $python --version
if ($LASTEXITCODE -ne 0) { throw 'Python ne repond pas. Reinstalle Python puis reessaie.' }

Write-Host 'Installation des dependances...'
& $python -m pip install -q -r (Join-Path $repo 'scripts\requirements.txt')
if ($LASTEXITCODE -ne 0) { throw 'Installation des dependances echouee.' }

$defaultKey = Join-Path $env:USERPROFILE 'Documents\ETS VANDAELE ET FILS\Site\curage-vandaele-firebase-adminsdk-fbsvc-5b779aa640.json'
$keyPath = Read-Host "Chemin du fichier JSON de la cle Firebase [$defaultKey]"
if (-not $keyPath) { $keyPath = $defaultKey }
$keyJson = Get-Content -Raw -LiteralPath $keyPath | ConvertFrom-Json | ConvertTo-Json -Compress

$orangeUser = Read-Host 'Adresse Orange [vandaelemarcel@orange.fr]'
if (-not $orangeUser) { $orangeUser = 'vandaelemarcel@orange.fr' }
$secure = Read-Host 'Mot de passe Orange (ou mot de passe d''application)' -AsSecureString
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
$orangePassword = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)

[Environment]::SetEnvironmentVariable('ORANGE_IMAP_USER', $orangeUser, 'User')
[Environment]::SetEnvironmentVariable('ORANGE_IMAP_PASSWORD', $orangePassword, 'User')
[Environment]::SetEnvironmentVariable('FIREBASE_SERVICE_ACCOUNT_JSON', $keyJson, 'User')
$env:ORANGE_IMAP_USER = $orangeUser
$env:ORANGE_IMAP_PASSWORD = $orangePassword
$env:FIREBASE_SERVICE_ACCOUNT_JSON = $keyJson

$action = New-ScheduledTaskAction -Execute $python -Argument "`"$syncScript`"" -WorkingDirectory $repo
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) `
    -RepetitionInterval (New-TimeSpan -Hours 1) -RepetitionDuration (New-TimeSpan -Days 3650)
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Minutes 30)
Register-ScheduledTask -TaskName 'Sync mails Orange admin' -Action $action -Trigger $trigger `
    -Settings $settings -Description 'Synchronise la boite Orange vers Firestore (admin Vandaele)' -Force | Out-Null
Write-Host 'Tache planifiee creee : toutes les heures, quand la session est ouverte.'

# Surveillance : synchro immediate quand le bouton "Rafraichir les mails" de l'admin est utilise
$watchAction = New-ScheduledTaskAction -Execute $python -Argument "`"$syncScript`" --watch" -WorkingDirectory $repo
$watchTrigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$watchSettings = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
Register-ScheduledTask -TaskName 'Sync mails Orange (rafraichir)' -Action $watchAction -Trigger $watchTrigger `
    -Settings $watchSettings -Description 'Synchro immediate des mails Orange sur demande depuis l admin' -Force | Out-Null
Start-ScheduledTask -TaskName 'Sync mails Orange (rafraichir)'
Write-Host 'Tache de surveillance creee : la synchro se lance des que tu cliques sur Rafraichir les mails.'

Write-Host 'Premiere synchro...'
& $python $syncScript
