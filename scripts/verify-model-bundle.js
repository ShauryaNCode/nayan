const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const manifestPath = path.join(root, 'models', 'model_manifest.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

let totalBytes = 0;
let failed = false;

for (const model of manifest.models) {
  const filePath = path.join(root, model.expectedPath);
  if (!fs.existsSync(filePath)) {
    console.warn(`MISSING ${model.id}: ${model.expectedPath}`);
    continue;
  }

  const bytes = fs.readFileSync(filePath);
  const sizeMb = bytes.length / (1024 * 1024);
  const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
  totalBytes += bytes.length;

  console.log(
    `${model.id}: ${sizeMb.toFixed(2)} MB sha256=${sha256} path=${model.expectedPath}`,
  );

  if (model.targetSizeMb != null && sizeMb > model.targetSizeMb) {
    failed = true;
    console.error(
      `SIZE FAIL ${model.id}: ${sizeMb.toFixed(2)} MB > ${model.targetSizeMb} MB`,
    );
  }
}

const totalMb = totalBytes / (1024 * 1024);
console.log(`Total model bundle: ${totalMb.toFixed(2)} MB`);
if (totalMb > manifest.bundleLimitMb) {
  failed = true;
  console.error(
    `BUNDLE SIZE FAIL: ${totalMb.toFixed(2)} MB > ${manifest.bundleLimitMb} MB`,
  );
}

if (failed) {
  process.exit(1);
}
