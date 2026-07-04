// PM2 process file for deploying Taxify on Linux.
// Usage (as the mike1118 user): pm2 start ecosystem.config.cjs
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
