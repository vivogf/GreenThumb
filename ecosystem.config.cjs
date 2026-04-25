const { readFileSync } = require('fs');
const envFile = readFileSync('.env', 'utf8');
const env = {};
envFile.split('\n').forEach(line => {
  line = line.trim();
  if (!line || line.startsWith('#')) return;
  const [key, ...rest] = line.split('=');
  env[key.trim()] = rest.join('=').trim();
});

module.exports = {
  apps: [{
    name: 'greenthumb',
    script: 'dist/index.js',
    env
  }]
};
