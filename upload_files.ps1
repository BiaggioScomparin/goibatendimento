$batPath = "C:\Users\biagg\Desktop\WHATICKET_SISTEMA_COMPLETO\ssh_askpass.bat"
"@echo 5kR8qpzA5BtV9S2w" | Set-Content -Path $batPath -Encoding Ascii

$env:SSH_ASKPASS = $batPath
$env:SSH_ASKPASS_REQUIRE = "force"
$env:DISPLAY = "dummy:0"

& scp -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null C:\Users\biagg\Desktop\WHATICKET_SISTEMA_COMPLETO\config.json root@184.107.176.201:/home/deploy/lead-watcher/config.json
& scp -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null C:\Users\biagg\Desktop\WHATICKET_SISTEMA_COMPLETO\watcher.js root@184.107.176.201:/home/deploy/lead-watcher/watcher.js
