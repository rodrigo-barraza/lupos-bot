module.exports = {
  apps: [
    {
      name: "lupos-services",
      cwd: __dirname,
      script: "lupos.js",
      args: "mode=services",
      interpreter: process.execPath,
      env: {
        NODE_ENV: "production",
      },
    },
    {
      name: "lupos-messages",
      cwd: __dirname,
      script: "lupos.js",
      args: "mode=messages",
      interpreter: process.execPath,
      env: {
        NODE_ENV: "production",
      },
    },
  ],
};
