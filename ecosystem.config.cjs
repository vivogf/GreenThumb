// pm2 process file for the production server. Secrets stay in .env next to this file (never in git).
const { readFileSync, existsSync } = require('fs');
const path = require('path');

function loadEnv(file) {
  const env = {};
  if (!existsSync(file)) return env;
  readFileSync(file, 'utf8').split('\n').forEach((raw) => {
    const line = raw.trim();
    if (!line || line.startsWith('#')) return;
    const [key, ...rest] = line.split('=');
    env[key.trim()] = rest.join('=').trim();
  });
  return env;
}

module.exports = {
  apps: [{
    name: 'greenthumb',
    cwd: __dirname,
    script: 'dist/index.js',
    max_memory_restart: '450M',
    env: {
      ...loadEnv(path.join(__dirname, '.env')),
      NODE_ENV: 'production',
      // nginx is the only public entry point.
      HOST: '127.0.0.1',
      PORT: '5000',
    },
  }],
};
