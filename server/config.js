const fs = require('fs');
const path = require('path');

// Lecture de config.env (KEY=valeur), partagée par tout le serveur. Les variables d'environnement passent avant.

function readConfig() {
  const config = {};
  const configPath = path.join(__dirname, 'config.env');
  if (fs.existsSync(configPath)) {
    fs.readFileSync(configPath, 'utf8').split(/\r?\n/).forEach((line) => {
      const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (match) config[match[1]] = match[2];
    });
  }
  return config;
}

const config = readConfig();
const setting = (key, fallback) => process.env[key] || config[key] || fallback;

module.exports = { config, setting };
