// PM2 fallback config. NOTE: Docker (deploy.sh) is the primary deploy
// path — this file exists only for running the bot under PM2 directly.
// Runs TypeScript directly via Node 26 native type stripping (no build).
module.exports = {
  apps: [
    {
      name: "lupos",
      cwd: __dirname,
      script: "src/boot.ts",
      interpreter: process.execPath,
      env: {
        NODE_ENV: "production",
      },
    },
  ],
};
