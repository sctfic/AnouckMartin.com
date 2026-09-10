/* ============================================================
   PM2 — Anouck Martin
   ------------------------------------------------------------
   Démarrage    : pm2 start ecosystem.config.js --env production
   Rechargement : pm2 reload anouckmartin
   Logs         : pm2 logs anouckmartin
   ------------------------------------------------------------
   PORT doit rester identique au proxy nginx :
     proxy_pass http://127.0.0.1:3210;
   ============================================================ */
module.exports = {
  apps: [
    {
      name: 'anouckmartin',
      script: 'server.js',      // fichier lancé par PM2 (ne pas préfixer par « node »)
      cwd: __dirname,           // dossier du site (où se trouvent index.html et content.json)
      instances: 1,             // 1 seul process : écritures JSON séquentielles
      exec_mode: 'fork',
      watch: true,              // redémarre à chaque upload de nouvelles versions du code
      watch_delay: 1000,        // anti-rebond (évite les redémarrages multiples)
      ignore_watch: [           // ne pas redémarrer sur les données / fichiers générés
        'node_modules',
        '.git',
        'logs',
        'backups',
        'content.json',
        'admin.json',
        '*.log'
      ],
      autorestart: true,
      max_memory_restart: '256M',
      env: {
        NODE_ENV: 'development',
        PORT: 3210,
        ROOT: __dirname
      },
      env_production: {
        NODE_ENV: 'production',
        PORT: 3210,
        ROOT: __dirname
      }
    }
  ]
};

