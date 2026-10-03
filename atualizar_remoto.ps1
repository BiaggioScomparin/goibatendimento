# ==================================================================
# ATUALIZADOR REMOTO PARA VPS WHATICKET / MULTIZAP 2026
# ==================================================================

$ErrorActionPreference = "Stop"
$IP = "184.107.176.201" # <-- IP DA SUA VPS
$INSTANCIA = "multizap" # <-- MUDE ISSO PARA O NOME DA SUA INSTÂNCIA
$INSTALL_PATH = "$PSScriptRoot\install"

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host " ATUALIZADOR AUTOMÁTICO - VPS $IP" -ForegroundColor Cyan
Write-Host " Instância: $INSTANCIA" -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host ""

Write-Host "[1/2] Enviando pasta install atualizada para a VPS..." -ForegroundColor Yellow
Write-Host "DICA: Quando solicitado, digite a senha de root da VPS." -ForegroundColor DarkGray
scp -r "$INSTALL_PATH" "root@${IP}:/root/"

if ($LASTEXITCODE -ne 0) {
    Write-Host "Erro ao enviar os arquivos para a VPS. Verifique sua conexão/senha." -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "[2/2] Executando script de atualização na VPS ($INSTANCIA)..." -ForegroundColor Yellow
Write-Host "DICA: Digite a senha novamente se o SSH solicitar." -ForegroundColor DarkGray
ssh -t "root@${IP}" "cd /root/install && chmod +x atualizar_instancia.sh && ./atualizar_instancia.sh $INSTANCIA"

Write-Host ""
Write-Host "==========================================================" -ForegroundColor Green
Write-Host " ✅ ATUALIZAÇÃO CONCLUÍDA COM SUCESSO!" -ForegroundColor Green
Write-Host " Todos os seus contatos, conversas e mídias foram mantidos." -ForegroundColor Green
Write-Host "==========================================================" -ForegroundColor Green
