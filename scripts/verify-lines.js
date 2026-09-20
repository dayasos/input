const fs = require('fs');
const path = require('path');

function getFiles(dir, fileList = []) {
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const filePath = path.join(dir, file);
    if (['node_modules', '.git', 'dist', 'archive', 'package-lock.json'].some(ex => filePath.includes(ex))) continue;
    const stat = fs.statSync(filePath);
    if (stat.isDirectory()) {
      getFiles(filePath, fileList);
    } else if (/\.(html|js|ts|mjs|css|json)$/i.test(file)) {
      fileList.push(filePath);
    }
  }
  return fileList;
}

const allFiles = getFiles('.');
let anyExceed = false;
console.log('=== VERIFIKASI BATAS MAKSIMAL 3.500 BARIS KODE PER FILE ===');
allFiles.forEach(f => {
  const count = fs.readFileSync(f, 'utf8').split('\n').length;
  const rel = path.relative('.', f);
  const status = count <= 3500 ? '✅ OK' : '❌ MELEBIHI 3500';
  if (count > 3500) anyExceed = true;
  console.log(`${rel.padEnd(55)} : ${count.toString().padStart(5)} baris [${status}]`);
});
console.log('-----------------------------------------------------------');
console.log(anyExceed ? '❌ PERINGATAN: Ada file yang melebihi batas 3.500 baris!' : '🎉 SEMPURNA: Semua file aktif mematuhi aturan <= 3.500 baris kode.');
