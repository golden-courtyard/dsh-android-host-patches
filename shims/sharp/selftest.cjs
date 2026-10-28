'use strict';
/**
 * sharp 后端自测 —— 覆盖 dsh-attachment-local 实际走的调用面：
 *   metadata → 全解码(raw) → rotate/toColourspace/resize → jpeg/webp 编码
 *   → 重新 metadata 校验（verifyRequestImage 的判据）
 *
 * 用法: node selftest.cjs <图片路径>
 */

const fs = require('node:fs');
const sharp = require('./index.cjs');

const file = process.argv[2];
if (!file) {
  console.error('用法: node selftest.cjs <图片路径>');
  process.exit(2);
}

let failed = 0;
const check = (ok, label, detail) => {
  console.log(`  ${ok ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failed += 1;
};

(async () => {
  const buf = fs.readFileSync(file);
  console.log(`  后端: ${sharp.versions.vips}, 输入 ${buf.length} B`);

  const meta = await sharp(buf, { failOn: 'error', limitInputPixels: false }).metadata();
  check(
    Number.isInteger(meta.width) && meta.width > 1 && meta.height > 1,
    'metadata 尺寸',
    `${meta.format} ${meta.width}x${meta.height} ${meta.depth} ${meta.space} alpha=${meta.hasAlpha}`,
  );

  const raw = await sharp(buf).raw().toBuffer();
  const expectRaw = meta.width * meta.height * meta.channels;
  check(raw.length === expectRaw, '全解码(raw)', `${raw.length} B, 期望 ${expectRaw}`);

  // 模拟 request-image 变体：长边收到 800，jpeg 82
  const target = 800;
  const scale = Math.min(1, target / Math.max(meta.width, meta.height));
  const wantW = Math.max(1, Math.floor(meta.width * scale));
  const wantH = Math.max(1, Math.floor(meta.height * scale));
  const { data, info } = await sharp(buf, { failOn: 'error', limitInputPixels: false })
    .rotate()
    .toColourspace('srgb')
    .resize({ width: wantW, height: wantH, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 82 })
    .toBuffer({ resolveWithObject: true });

  check(info.format === 'jpeg', '编码格式', info.format);
  check(
    Math.abs(info.width - wantW) <= 1 && Math.abs(info.height - wantH) <= 1,
    '缩放尺寸',
    `得到 ${info.width}x${info.height}, 期望 ${wantW}x${wantH}`,
  );
  check(data.length < buf.length, '体积下降', `${data.length} B`);

  // verifyRequestImage 判据：重新解码，事实必须与声明的对齐
  const again = await sharp(data).metadata();
  check(
    again.format === 'jpeg' && again.width === info.width && again.height === info.height,
    '回读校验',
    `${again.format} ${again.width}x${again.height}`,
  );

  console.log(failed === 0 ? '  PASS' : `  FAIL (${failed})`);
  process.exit(failed === 0 ? 0 : 1);
})().catch((e) => {
  console.error('  FAIL:', e.message);
  process.exit(1);
});
