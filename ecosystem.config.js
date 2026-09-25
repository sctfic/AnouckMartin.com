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
      script: 'backend/server.js',
      cwd: __dirname,           // racine du projet
      instances: 1,             // 1 seul process : écritures JSON séquentielles
      exec_mode: 'fork',
      treekill: false,          // le worker détaché doit survivre au redémarrage du serveur
      watch: false,             // le déploiement redémarre PM2 une fois la copie complète
      watch_delay: 1000,        // anti-rebond (évite les redémarrages multiples)
      ignore_watch: [           // ne pas redémarrer sur les données / fichiers générés
        'node_modules',
        '.git',
        'logs',
        'backend/data',
        'backups',
        'frontend/content.json',
        '*.log'
      ],
      autorestart: true,
      max_memory_restart: '256M',
      env: {
        NODE_ENV: 'development',
        PORT: 3210,
        ROOT: require('path').join(__dirname, 'frontend'),
        DATA_DIR: require('path').join(__dirname, 'backend', 'data')
      },
      env_production: {
        NODE_ENV: 'production',
        ENABLE_UPDATES: '1',
        PORT: 3210,
        ROOT: require('path').join(__dirname, 'frontend'),
        DATA_DIR: require('path').join(__dirname, 'backend', 'data')
      }
    }
  ]
};

