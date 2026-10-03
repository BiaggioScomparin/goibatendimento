param([string]$Command)
$batPath = "C:\Users\biagg\Desktop\WHATICKET_SISTEMA_COMPLETO\ssh_askpass.bat"
"@echo 5kR8qpzA5BtV9S2w" | Set-Content -Path $batPath -Encoding Ascii

$env:SSH_ASKPASS = $batPath
$env:SSH_ASKPASS_REQUIRE = "force"
$env:DISPLAY = "dummy:0"

if ($Command) {
    & ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o ConnectTimeout=15 -o ServerAliveInterval=10 root@184.107.176.201 "$Command"
} else {
    $cmdFile = "C:\Users\biagg\Desktop\WHATICKET_SISTEMA_COMPLETO\remote_cmd.sh"
    if (Test-Path $cmdFile) {
        & scp -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o ConnectTimeout=15 $cmdFile root@184.107.176.201:/tmp/remote_cmd.sh
        & ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o ConnectTimeout=15 -o ServerAliveInterval=10 root@184.107.176.201 "bash /tmp/remote_cmd.sh"
    }
}
