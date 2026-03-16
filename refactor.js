import fs from 'fs';
import path from 'path';

function walkDir(dir, callback) {
  fs.readdirSync(dir).forEach(f => {
    let dirPath = path.join(dir, f);
    if (dirPath.includes('node_modules') || dirPath.includes('.git') || dirPath.includes('.vscode')) return;
    let isDirectory = fs.statSync(dirPath).isDirectory();
    isDirectory ? walkDir(dirPath, callback) : callback(dirPath);
  });
}

// 1. Move utilities to utilities.js
if (fs.existsSync('./libraries/utilities.js')) {
  fs.renameSync('./libraries/utilities.js', './utilities.js');
  console.log('Moved utilities.js to utilities.js');
}

// 2. Consolidate Arrays
let arraysExport = '';
if (fs.existsSync('./arrays')) {
  fs.readdirSync('./arrays').forEach(file => {
    if (file.endsWith('.js')) {
      let content = fs.readFileSync(`./arrays/${file}`, 'utf8');
      // replace export default X; with export const X = ... or export { X };
      // To simplify, we'll just read the content, remove the 'export default', and append it to our arraysExport.
      content = content.replace(/export default \w+;/, '');
      arraysExport += content + '\n';
    }
  });

  // Adding exports for them manually since we know what they are
  arraysExport += `
export { default as birthdays } from './arrays/birthdays.js';
export { default as channels } from './arrays/channels.js';
export { default as ignorePhrases } from './arrays/ignorePhrases.js';
export * from './arrays/roles.js';
export { default as users } from './arrays/users.js';
`;
  // Actually, merging them fully is better. Let's just create a file that exports them from their original paths for now, or read properly.
  // Given their complexity, let's just make arrays.js re-export them all, but the user wants an arrays.js file "for arrays".
  // Since we already have the arrays in the directory, we'll just re-export or we can merge. Let's merge the strings.
}

// Let's take a simpler approach: Re-exporting in arrays.js and constants.js
fs.writeFileSync('./arrays.js', `
export { default as birthdays } from './arrays/birthdays.js';
export { default as channels } from './arrays/channels.js';
export { default as ignorePhrases } from './arrays/ignorePhrases.js';
export * from './arrays/roles.js';
export { default as users } from './arrays/users.js';
`);
console.log('Created arrays.js');

fs.writeFileSync('./constants.js', `
export { default as ClockCrewConstants } from './constants/ClockCrewConstants.js';
export { default as MessageConstants } from './constants/MessageConstants.js';
export { default as MessageConstantsOld } from './constants/MessageConstantsOld.js';
`);
console.log('Created constants.js');

// 3. Update all imports
walkDir('.', function(filePath) {
  if (filePath.endsWith('.js') || filePath.endsWith('.test.js') || filePath.endsWith('.cjs')) {
    let content = fs.readFileSync(filePath, 'utf8');
    let initialContent = content;

    // Config
    content = content.replace(/import\s+(.*?)\s+from\s+['"]#root\/config\.json['"]\s+with\s+\{\s*type:\s*['"]json['"]\s*\};/g, 'import $1 from "#root/config.js";');
    content = content.replace(/import\s+(.*?)\s+from\s+['"]\.\/config\.json['"]\s+with\s+\{\s*type:\s*['"]json['"]\s*\};/g, 'import $1 from "./config.js";');
    content = content.replace(/import\s+(.*?)\s+from\s+['"]\.\.\/\.\.\/config\.json['"]\s+with\s+\{\s*type:\s*['"]json['"]\s*\};/g, 'import $1 from "../../config.js";');
    content = content.replace(/jest\.unstable_mockModule\(['"]#root\/config\.json['"]/g, 'jest.unstable_mockModule("#root/config.js"');

    // utilities -> utilities
    content = content.replace(/['"]#root\/libraries\/utilities\.js['"]/g, '"#root/utilities.js"');
    content = content.replace(/utilities/g, 'utilities');

    // Arrays
    content = content.replace(/import\s+(.*?)\s+from\s+['"]#root\/arrays\/.*?['"];/g, 'import { $1 } from "#root/arrays.js";');
    // Constants
    content = content.replace(/import\s+(.*?)\s+from\s+['"]#root\/constants\/.*?['"];/g, 'import { $1 } from "#root/constants.js";');

    if (content !== initialContent) {
      fs.writeFileSync(filePath, content);
      console.log('Updated: ' + filePath);
    }
  }
});
