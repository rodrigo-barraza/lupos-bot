// PM2 fallback config. NOTE: Docker (deploy.sh) is the primary deploy
// path — this file exists only for running the bot under PM2 directly.
// Requires a prior `pnpm build` (script points at the compiled output).
module.exports = {
  apps: [
    {
      name: "lupos",
      cwd: __dirname,
      script: "dist/boot.js",
      interpreter: process.execPath,
      env: {
        NODE_ENV: "production",
      },
    },
  ],
};
