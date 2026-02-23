const fs = require('fs');
const path = require('path');

function walk(dir) {
    let results = [];
    const list = fs.readdirSync(dir);
    list.forEach(file => {
        file = path.resolve(dir, file);
        const stat = fs.statSync(file);
        if (stat && stat.isDirectory() && !file.includes('node_modules') && !file.includes('.git') && !file.includes('.ws')) {
            results = results.concat(walk(file));
        } else if (file.endsWith('.js') || file.endsWith('.json')) {
            results.push(file);
        }
    });
    return results;
}

const files = walk('.');
let changed = 0;

files.forEach(file => {
    let content = fs.readFileSync(file, 'utf8');
    let original = content;

    content = content.replaceAll("'#/", "'#root/");
    content = content.replaceAll("\"#/", "\"#root/");

    // Also replace in package.json the imports mapping
    if (file.endsWith('package.json')) {
        if (content.includes('"#/*": "./*"')) {
            content = content.replace('"#/*": "./*"', '"#root/*": "./*"');
        }
    }

    if (content !== original) {
        fs.writeFileSync(file, content);
        changed++;
        console.log(`Updated: ${file}`);
    }
});
console.log(`Total files changed: ${changed}`);
