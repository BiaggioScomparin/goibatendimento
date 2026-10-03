$batPath = "C:\Users\biagg\Desktop\WHATICKET_SISTEMA_COMPLETO\ssh_askpass.bat"
"@echo 5kR8qpzA5BtV9S2w" | Set-Content -Path $batPath -Encoding Ascii

$env:SSH_ASKPASS = $batPath
$env:SSH_ASKPASS_REQUIRE = "force"
$env:DISPLAY = "dummy:0"

Write-Host "1. Enviando calendar_new.js -> calendar.js..."
& scp -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null C:\Users\biagg\Desktop\WHATICKET_SISTEMA_COMPLETO\calendar_new.js root@184.107.176.201:/home/deploy/lead-watcher/calendar.js

Write-Host "2. Enviando remarketing.js -> remarketing.js..."
& scp -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null C:\Users\biagg\Desktop\WHATICKET_SISTEMA_COMPLETO\remarketing.js root@184.107.176.201:/home/deploy/lead-watcher/remarketing.js

Write-Host "3. Enviando watcher_new.js -> watcher.js..."
& scp -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null C:\Users\biagg\Desktop\WHATICKET_SISTEMA_COMPLETO\watcher_new.js root@184.107.176.201:/home/deploy/lead-watcher/watcher.js

Write-Host "4. Enviando api_new.js -> api.js..."
& scp -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null C:\Users\biagg\Desktop\WHATICKET_SISTEMA_COMPLETO\api_new.js root@184.107.176.201:/home/deploy/lead-watcher/api.js

Write-Host "5. Enviando index_new.html -> public/index.html..."
& scp -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null C:\Users\biagg\Desktop\WHATICKET_SISTEMA_COMPLETO\index_new.html root@184.107.176.201:/home/deploy/lead-watcher/public/index.html

Write-Host "5b. Enviando config.json -> config.json..."
& scp -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null C:\Users\biagg\Desktop\WHATICKET_SISTEMA_COMPLETO\config.json root@184.107.176.201:/home/deploy/lead-watcher/config.json

Write-Host "6. Verificando sintaxe no Node..."
& ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null root@184.107.176.201 "node -c /home/deploy/lead-watcher/calendar.js && node -c /home/deploy/lead-watcher/remarketing.js && node -c /home/deploy/lead-watcher/watcher.js && node -c /home/deploy/lead-watcher/api.js"

Write-Host "7. Reiniciando PM2 lead-watcher..."
& ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null root@184.107.176.201 "chown -R deploy:deploy /home/deploy/lead-watcher && su - deploy -c 'pm2 restart lead-watcher'"

Write-Host "Sucesso!"
