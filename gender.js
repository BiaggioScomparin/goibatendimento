const fs = require('fs');
const path = require('path');

const CACHE_FILE = path.join(__dirname, 'gender_cache.json');
let cache = {};

try {
  if (fs.existsSync(CACHE_FILE)) {
    cache = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf-8'));
  }
} catch (e) {
  cache = {};
}

function saveCache() {
  try {
    fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2), 'utf-8');
  } catch (e) {}
}

// Lista expressa de nomes comuns para resposta instantânea
const FEMALE_NAMES = new Set([
  'maria', 'ana', 'bruna', 'juliana', 'camila', 'vanessa', 'priscila', 'aline', 'jessica',
  'patricia', 'amanda', 'fernanda', 'leticia', 'beatriz', 'gabriela', 'larissa', 'luciana',
  'carolina', 'mariana', 'daniela', 'renata', 'simone', 'cristiane', 'carla', 'valeria',
  'claudia', 'adrianne', 'adrianna', 'adriana', 'agatha', 'izabel', 'isabel', 'isabela',
  'valdete', 'sirlei', 'jeruza', 'leonor', 'joelma', 'elisa', 'rosangela', 'regina',
  'silvia', 'sandra', 'fatima', 'monica', 'debora', 'paula', 'raquel', 'marcia', 'eliane',
  'tatiane', 'andrea', 'viviane', 'marta', 'sonia', 'denise', 'sabrina', 'tamires'
]);

const MALE_NAMES = new Set([
  'jose', 'joao', 'antonio', 'francisco', 'carlos', 'paulo', 'pedro', 'lucas', 'luiz',
  'luis', 'marcos', 'rafael', 'daniel', 'marcelo', 'bruno', 'eduardo', 'felipe', 'rodrigo',
  'manoel', 'mateus', 'matheus', 'andre', 'fernando', 'fabio', 'leonardo', 'gustavo',
  'guilherme', 'leandro', 'tiago', 'thiago', 'anderson', 'alessandro', 'alexandre', 'rogerio',
  'sergio', 'claudio', 'marcio', 'roberto', 'vitor', 'victor', 'diego', 'cesar', 'renato',
  'valdeir', 'biaggio', 'elvis', 'gilson', 'franklin', 'vagner', 'davi', 'yuri', 'neemias',
  'jonathan', 'clayton', 'arthur', 'walter', 'edson', 'rosendo', 'clovis', 'douglas', 'valter'
]);

function normalizeName(name) {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

async function detectGender(firstName) {
  if (!firstName) return { gender: 'UNKNOWN', confidence: 0 };
  const clean = normalizeName(firstName);

  if (cache[clean]) {
    return cache[clean];
  }

  if (FEMALE_NAMES.has(clean)) {
    cache[clean] = { gender: 'F', source: 'dictionary' };
    saveCache();
    return cache[clean];
  }

  if (MALE_NAMES.has(clean)) {
    cache[clean] = { gender: 'M', source: 'dictionary' };
    saveCache();
    return cache[clean];
  }

  // Consulta API oficial do IBGE
  try {
    const [resF, resM] = await Promise.all([
      fetch(`https://servicodados.ibge.gov.br/api/v2/censos/nomes/${encodeURIComponent(clean)}?sexo=f`).then(r => r.json()).catch(() => []),
      fetch(`https://servicodados.ibge.gov.br/api/v2/censos/nomes/${encodeURIComponent(clean)}?sexo=m`).then(r => r.json()).catch(() => [])
    ]);

    let countF = 0;
    let countM = 0;

    if (Array.isArray(resF) && resF.length > 0 && resF[0].res) {
      countF = resF[0].res.reduce((acc, curr) => acc + (curr.frequencia || 0), 0);
    }

    if (Array.isArray(resM) && resM.length > 0 && resM[0].res) {
      countM = resM[0].res.reduce((acc, curr) => acc + (curr.frequencia || 0), 0);
    }

    if (countF > 0 || countM > 0) {
      const total = countF + countM;
      const pctF = countF / total;
      const gender = pctF >= 0.6 ? 'F' : 'M';
      cache[clean] = { gender, countF, countM, pctF: Math.round(pctF * 100), source: 'ibge' };
      saveCache();
      return cache[clean];
    }
  } catch (err) {
    // Falha na API
  }

  // Regra heurística simples para o português se não encontrado no IBGE
  let gender = 'M';
  if (clean.endsWith('a') && !['lucas', 'jonas', 'elias', 'matias', 'lucca', 'luca', 'joshua'].includes(clean)) {
    gender = 'F';
  }

  cache[clean] = { gender, source: 'heuristic' };
  saveCache();
  return cache[clean];
}

module.exports = { detectGender };
