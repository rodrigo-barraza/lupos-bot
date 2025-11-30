module.exports = {
  apps: [{
    name: 'lupos services',
    script: 'lupos.js',
    interpreter: process.execPath, // Use current Node.js interpreter
    node_args: '-- mode=services',
    env: {
      NODE_ENV: 'production',
      // Ensure proper Node.js version
      NODE_VERSION: process.version
    }
  }]
};
