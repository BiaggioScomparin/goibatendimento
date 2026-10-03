#!/bin/bash
set -e

echo "=========================================================="
echo " [1/7] Extraindo Whaticket Clean (Backend + Frontend)..."
echo "=========================================================="
mkdir -p /home/deploy/now7
rm -rf /home/deploy/now7/backend /home/deploy/now7/frontend
tar -xzf /root/whaticket_clean.tar.gz -C /home/deploy/now7/
chown -R deploy:deploy /home/deploy/now7

echo "=========================================================="
echo " [2/7] Configurando Redis (Docker)..."
echo "=========================================================="
systemctl enable --now docker
docker rm -f redis-now7 2>/dev/null || true
docker run --name redis-now7 -p 5000:6379 --restart always -d redis:alpine redis-server --requirepass 5kR8qpzA5BtV9S2w

echo "=========================================================="
echo " [3/7] Configurando PostgreSQL..."
echo "=========================================================="
systemctl enable --now postgresql
sudo -u postgres psql -c "DROP DATABASE IF EXISTS now7;" 2>/dev/null || true
sudo -u postgres psql -c "DROP USER IF EXISTS now7;" 2>/dev/null || true
sudo -u postgres psql -c "CREATE USER now7 WITH SUPERUSER INHERIT CREATEDB CREATEROLE PASSWORD '5kR8qpzA5BtV9S2w';"
sudo -u postgres psql -c "CREATE DATABASE now7 OWNER now7;"

echo "=========================================================="
echo " [4/7] Configurando arquivos de ambiente (.env)..."
echo "=========================================================="
cat << 'EOF' > /home/deploy/now7/backend/.env
NODE_ENV=production
BACKEND_URL=https://api.7now.xyz
FRONTEND_URL=https://app.7now.xyz
PROXY_PORT=443
PORT=4000

DB_HOST=localhost
DB_DIALECT=postgres
DB_USER=now7
DB_PASS=5kR8qpzA5BtV9S2w
DB_NAME=now7
DB_PORT=5432

JWT_SECRET=f8e918237bba8d2345eaf1283940192834710293847581920394857102938475
JWT_REFRESH_SECRET=a8b7c6d5e4f3a2b1c0d9e8f7a6b5c4d3e2f1a0b9c8d7e6f5a4b3c2d1e0f9a8b7

REDIS_URI=redis://:5kR8qpzA5BtV9S2w@127.0.0.1:5000
REDIS_OPT_LIMITER_MAX=1
REDIS_OPT_LIMITER_DURATION=3000

USER_LIMIT=999
CONNECTIONS_LIMIT=999
CLOSED_SEND_BY_ME=true

GERENCIANET_SANDBOX=false
GERENCIANET_CLIENT_ID=sua-id
GERENCIANET_CLIENT_SECRET=sua_chave_secreta
GERENCIANET_PIX_CERT=nome_do_certificado
GERENCIANET_PIX_KEY=chave_pix_gerencianet
EOF

cat << 'EOF' > /home/deploy/now7/frontend/.env
REACT_APP_BACKEND_URL=https://api.7now.xyz
REACT_APP_HOURS_CLOSE_TICKETS_AUTO=24
EOF

cat << 'EOF' > /home/deploy/now7/frontend/server.js
const http = require("http");
const fs = require("fs");
const path = require("path");

var PORT = 3000;
var BUILD = path.join(__dirname, "build");

var MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css",
  ".js": "application/javascript",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".eot": "application/vnd.ms-fontobject",
  ".xml": "application/xml",
  ".txt": "text/plain",
  ".mp3": "audio/mpeg",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".webp": "image/webp",
  ".pdf": "application/pdf",
};

var server = http.createServer(function (req, res) {
  var safePath = req.url.split("?")[0].split("#")[0];
  var filePath = path.join(BUILD, safePath === "/" ? "index.html" : safePath);

  fs.readFile(filePath, function (err, data) {
    if (err) {
      if (err.code === "ENOENT") {
        fs.readFile(path.join(BUILD, "index.html"), function (err2, data2) {
          if (err2) {
            res.writeHead(404, { "Content-Type": "text/plain" });
            res.end("Not Found");
          } else {
            res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
            res.end(data2);
          }
        });
      } else {
        res.writeHead(500, { "Content-Type": "text/plain" });
        res.end("Internal Server Error");
      }
      return;
    }
    var ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
    res.end(data);
  });
});

server.listen(PORT, function () {
  console.log("Frontend running on port " + PORT);
});
EOF

chown -R deploy:deploy /home/deploy/now7

echo "=========================================================="
echo " [5/7] Instalando e Compilando Backend..."
echo "=========================================================="
cd /home/deploy/now7/backend
sudo -u deploy npm install --legacy-peer-deps
sudo -u deploy npm run build
sudo -u deploy npx sequelize db:migrate
sudo -u deploy npx sequelize db:seed:all

echo "=========================================================="
echo " [6/7] Iniciando serviços no PM2..."
echo "=========================================================="
sudo -u deploy pm2 delete all 2>/dev/null || true
cd /home/deploy/now7/backend && sudo -u deploy pm2 start dist/server.js --name now7-backend --max-memory-restart 1024M
cd /home/deploy/now7/frontend && sudo -u deploy pm2 start server.js --name now7-frontend --max-memory-restart 512M
sudo -u deploy pm2 save
env PATH=$PATH:/usr/bin:/usr/local/bin pm2 startup systemd -u deploy --hp /home/deploy || true

echo "=========================================================="
echo " [7/7] Configurando Nginx e Certificado SSL..."
echo "=========================================================="
cat << 'EOF' > /etc/nginx/sites-available/now7-backend
server {
  server_name api.7now.xyz;
  location / {
    proxy_pass http://127.0.0.1:4000;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection 'upgrade';
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_cache_bypass $http_upgrade;
    proxy_read_timeout 86400s;
    proxy_send_timeout 86400s;
  }
}
EOF

cat << 'EOF' > /etc/nginx/sites-available/now7-frontend
server {
  server_name app.7now.xyz;
  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection 'upgrade';
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_cache_bypass $http_upgrade;
    proxy_read_timeout 86400s;
    proxy_send_timeout 86400s;
  }
}
EOF

ln -sf /etc/nginx/sites-available/now7-backend /etc/nginx/sites-enabled/
ln -sf /etc/nginx/sites-available/now7-frontend /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default

cat << 'EOF' > /etc/nginx/conf.d/deploy.conf
client_max_body_size 100M;
EOF

nginx -t
systemctl reload nginx

# Certbot
certbot --nginx --agree-tos --non-interactive -m admin@7now.xyz -d api.7now.xyz -d app.7now.xyz || true

echo "=========================================================="
echo " ✅ INSTALAÇÃO CONCLUÍDA COM SUCESSO!"
echo " Painel:  https://app.7now.xyz"
echo " API:     https://api.7now.xyz"
echo "=========================================================="
