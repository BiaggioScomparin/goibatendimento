param(
    [string]$RemoteCommand = "pm2 list"
)

$batPath = "C:\Users\biagg\Desktop\WHATICKET_SISTEMA_COMPLETO\ssh_askpass.bat"
"@echo 5kR8qpzA5BtV9S2w" | Set-Content -Path $batPath -Encoding Ascii

$env:SSH_ASKPASS = $batPath
$env:SSH_ASKPASS_REQUIRE = "force"
$env:DISPLAY = "dummy:0"

$bytes = [System.Text.Encoding]::UTF8.GetBytes("set -f; " + $RemoteCommand)
$b64 = [Convert]::ToBase64String($bytes)

& ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null root@184.107.176.201 "echo $b64 | base64 -d | bash"
