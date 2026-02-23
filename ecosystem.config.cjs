module.exports = {
  apps: [
    {
      name: 'lupos-services',
      script: 'lupos.js',
      args: 'mode=services',
      interpreter: process.execPath,
      env: {
        NODE_ENV: 'production'
      }
    },
    {
      name: 'lupos-messages',
      script: 'lupos.js',
      args: 'mode=messages',
      interpreter: process.execPath,
      env: {
        NODE_ENV: 'production'
      }
    }
  ]
};