// PM2 process file for deploying Taxify on Linux.
// Usage (as the mikes1118 user, whose pm2 owns this process — a pm2 daemon
// only ever sees its own user's, which is why deploy.sh insists on that user):
//   pm2 start ecosystem.config.cjs
module.exports = {
  apps: [
    {
      name: 'taxify',
      cwd: __dirname + '/server',
      script: 'src/index.js',
      interpreter: 'node',
      env: {
        NODE_ENV: 'production',
        PORT: 3004,
      },
    },
  ],
};
