/**
 * PM2 Ecosystem — APEX-Q
 *
 * Start everything:  pm2 start ecosystem.config.js
 * Save + auto-boot:  pm2 save && pm2 startup
 * Live logs:         pm2 logs
 * Restart scanner:   pm2 restart apex-q-scanner
 */

module.exports = {
  apps: [
    {
      name: 'apex-q-server',
      script: 'elliott_server.js',
      env: { NODE_ENV: 'production', PORT: 3005 },
      watch: false,
      autorestart: true,
      max_restarts: 10,
      restart_delay: 5000,
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
    },
    {
      name: 'apex-q-scanner',
      script: 'apex_scanner.js',
      env_file: '.env',
      watch: false,
      autorestart: true,
      max_restarts: 10,
      restart_delay: 5000,
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
    },
  ],
};
