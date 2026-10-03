# ==================================================================
# INSTALADOR REMOTO PARA VPS WHATICKET / MULTIZAP 2026 (DO ZERO)
# Envia os arquivos, configura Memória Swap e inicia o assistente
# ==================================================================

$ErrorActionPreference = "Stop"

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "   INSTALADOR AUTOMÁTICO WHATICKET / MULTIZAP 2026" -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host ""

# Permitir IP padrão ou digitar um novo
$defaultIP = "184.107.176.201"
$IP = Read-Host "Digite o IP da VPS [$defaultIP]"
if ([string]::IsNullOrWhiteSpace($IP)) {
    $IP = $defaultIP
}

$INSTALL_PATH = "$PSScriptRoot\install"

Write-Host ""
Write-Host "[1/3] Enviando arquivos de instalação para a VPS ($IP)..." -ForegroundColor Yellow
Write-Host "DICA: Digite a senha root da VPS quando solicitado." -ForegroundColor DarkGray
scp -o StrictHostKeyChecking=accept-new -r "$INSTALL_PATH" "root@${IP}:/root/"

if ($LASTEXITCODE -ne 0) {
    Write-Host "Erro ao enviar arquivos para a VPS. Verifique a senha ou a conexão." -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "[2/3] Verificando e garantindo Memória Swap (6GB) na VPS..." -ForegroundColor Yellow
Write-Host "[3/3] Abrindo o Assistente Interativo de Instalação..." -ForegroundColor Yellow
Write-Host "DICA: Digite a senha novamente se o SSH solicitar." -ForegroundColor DarkGray

# Comando remoto para criar Swap de 6GB se não existir, dar permissão e abrir o menu de instalação
$remoteCmd = "if [ \$(swapon -s | wc -l) -le 1 ]; then " +
             "echo 'Criando Swap de 6GB na VPS para máxima estabilidade...'; " +
             "fallocate -l 6G /swapfile 2>/dev/null || dd if=/dev/zero of=/swapfile bs=1M count=6144 2>/dev/null || true; " +
             "chmod 600 /swapfile || true; mkswap /swapfile || true; swapon /swapfile || true; " +
             "fi; " +
             "cd /root/install && chmod +x instalar_automatico instalar_primaria instalar_nova_instancia && ./instalar_automatico"

ssh -o StrictHostKeyChecking=accept-new -t "root@${IP}" $remoteCmd

Write-Host ""
Write-Host "==========================================================" -ForegroundColor Green
Write-Host " ✅ ASSISTENTE DE INSTALAÇÃO FINALIZADO!" -ForegroundColor Green
Write-Host "==========================================================" -ForegroundColor Green
