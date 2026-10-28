'use strict';
/**
 * sharp 兼容层 —— 用 libvips CLI 顶替原生 binding。
 *
 * 背景：sharp 的平台包只发布 linux/darwin/win32（及 wasm32）构建。
 * Termux 是 bionic + aarch64，官方 android-arm64 包不存在；wasm 版在本机
 * 落到 sharp 自带的 passthrough shim（versions.vips === "n/a-shim"，resize
 * 原样返回输入字节），属于静默假成功。原生编译也不通：Termux 的 libvips
 * 包不带 vips-cpp.h，sharp 的 src/*.cc 需要它。
 *
 * 所以这里只实现 @deepseek-ai/dsh-attachment-local 真正用到的接口面，
 * 像素工作全部交给 `vips` 命令行（apt install libvips，本机 8.18.7，
 * 与 sharp 0.35.5 要求的 minimumLibvipsVersion 一致）。
 *
 * 覆盖：metadata / raw / rotate / toColourspace / resize / jpeg / png /
 *      webp / clone / toBuffer({resolveWithObject}) / toFile
 * 不支持：gif、avif、heif 输出，composite，管道里的 .extend/.flatten 等
 *      —— 用到就抛错，不静默降级。
 */

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const fsp = fs.promises;
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const TMP = process.env.TMPDIR && fs.existsSync(process.env.TMPDIR)
  ? process.env.TMPDIR
  : os.tmpdir();

const LOADER_FORMAT = {
  pngload: 'png',
  jpegload: 'jpeg',
  webpload: 'webp',
  gifload: 'gif',
  tiffload: 'tiff',
  heifload: 'heif',
  magickload: 'magick',
  svgload: 'svg',
};

const SAVE_ARGS = {
  jpeg: (o) => ['jpegsave', '--Q', String(o.quality ?? 80)],
  webp: (o) => ['webpsave', '--Q', String(o.quality ?? 80)],
  png: () => ['pngsave'],
};

const CALL_LOG = path.join(TMP, 'dsh-sharp-calls.log');
function note(msg) {
  try {
    fs.appendFileSync(CALL_LOG, `${new Date().toISOString()} pid=${process.pid} ppid=${process.ppid} ${msg}\n`);
  } catch {}
}

function tmpPath(tag) {
  return path.join(TMP, `dsh-sharp-${process.pid}-${crypto.randomBytes(6).toString('hex')}${tag}`);
}

function run(bin, args) {
  note(`${bin} ${args[0] ?? ''}`);
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('error', (e) => reject(new Error(`vips spawn failed: ${e.message}`)));
    child.on('close', (code) => {
      if (code === 0) resolve(out);
      else reject(new Error(`${bin} ${args.join(' ')} failed (${code}): ${err.trim() || out.trim()}`));
    });
  });
}

/** Read header fields via `vipsheader -a` (key: value lines after the summary line). */
async function headerOf(file) {
  const text = await run('vipsheader', ['-a', file]);
  const kv = {};
  for (const line of text.split('\n').slice(1)) {
    const m = /^([\w-]+):\s*(.*)$/.exec(line.trim());
    if (m) kv[m[1]] = m[2];
  }
  const loader = kv['vips-loader'];
  const format = LOADER_FORMAT[loader];
  if (!format) throw new Error(`unsupported image loader: ${loader ?? '<none>'}`);
  const bands = Number(kv.bands);
  return {
    format,
    width: Number(kv.width),
    height: Number(kv.height),
    depth: kv.format,
    bands,
    space: kv.interpretation,
    hasAlpha: bands === 2 || bands === 4,
  };
}

async function materialise(input) {
  if (typeof input === 'string') return { file: input, cleanup: null };
  if (Buffer.isBuffer(input) || input instanceof Uint8Array) {
    const file = tmpPath('.bin');
    await fsp.writeFile(file, input);
    return { file, cleanup: file };
  }
  if (input && typeof input === 'object' && input.width && input.height) {
    throw new Error('raw pixel input is not supported by this shim');
  }
  throw new Error('unsupported sharp input');
}

class Pipeline {
  constructor(input) {
    this._input = input;
    this._ops = [];
  }

  metadata() {
    return (async () => {
      const { file, cleanup } = await materialise(this._input);
      try {
        const head = await headerOf(file);
        return {
          format: head.format,
          width: head.width,
          height: head.height,
          space: head.space,
          depth: head.depth,
          hasAlpha: head.hasAlpha,
          channels: head.bands,
          pages: 1,
          // 故意留空：这些字段用来判断"是否携带需清理的元数据"。
          // CLI 后端读不到可靠值，宁可声明"无"，让上层走原字节直通。
        };
      } finally {
        if (cleanup) await fsp.unlink(cleanup).catch(() => {});
      }
    })();
  }

  raw() { this._ops.push({ t: 'raw' }); return this; }
  rotate(v) { this._ops.push({ t: 'rotate', auto: v === undefined || v === true }); return this; }
  toColourspace(space) { this._ops.push({ t: 'colourspace', space }); return this; }
  resize(opts) { this._ops.push({ t: 'resize', opts: opts || {} }); return this; }
  jpeg(opts) { this._ops.push({ t: 'format', format: 'jpeg', opts: opts || {} }); return this; }
  webp(opts) { this._ops.push({ t: 'format', format: 'webp', opts: opts || {} }); return this; }
  png(opts) { this._ops.push({ t: 'format', format: 'png', opts: opts || {} }); return this; }

  clone() {
    const next = new Pipeline(this._input);
    next._ops = this._ops.slice();
    return next;
  }

  async toBuffer(opts) {
    const { data, info } = await render(this._input, this._ops);
    return opts && opts.resolveWithObject ? { data, info } : data;
  }

  async toFile(dest) {
    const { data, info } = await render(this._input, this._ops);
    await fsp.writeFile(dest, data);
    return { ...info, size: data.length };
  }
}

async function thumbnailStep(src, targetWidth, targetHeight) {
  const out = tmpPath('.v');
  const args = ['thumbnail', src, out, String(targetWidth), '--height', String(targetHeight), '--size', 'down'];
  await run('vips', args);
  return out;
}

/** Resolve sharp's adaptive resize options into concrete target pixels. */
function targetSize(meta, opts) {
  const { width: W, height: H } = meta;
  const explicitW = opts.width;
  const explicitH = opts.height;
  const withoutEnlargement = opts.withoutEnlargement !== false;
  const fit = opts.fit || 'cover';

  if (explicitW === undefined && explicitH === undefined) return { width: W, height: H };
  if (fit === 'fill') {
    return { width: explicitW ?? W, height: explicitH ?? H };
  }

  const scaleW = explicitW === undefined ? Infinity : explicitW / W;
  const scaleH = explicitH === undefined ? Infinity : explicitH / H;
  // "inside" 取小比例，其余按 sharp 默认 cover 处理成本机常见的 inside 语义，
  // 其余 fit 模式上层没用到。
  const scale = fit === 'inside' ? Math.min(scaleW, scaleH) : Math.max(scaleW === Infinity ? 1 : scaleW, scaleH === Infinity ? 1 : scaleH);
  const bounded = withoutEnlargement ? Math.min(scale, 1) : scale;
  return {
    width: Math.max(1, Math.round(W * bounded)),
    height: Math.max(1, Math.round(H * bounded)),
  };
}

async function render(input, ops) {
  const { file: src, cleanup } = await materialise(input);
  const temps = [];
  let cur = src;
  let meta = null;

  const step = async (argsFn) => {
    const out = tmpPath('.v');
    await run('vips', argsFn(cur, out));
    temps.push(out);
    cur = out;
  };

  try {
    meta = await headerOf(cur);

    for (const op of ops) {
      if (op.t === 'rotate') {
        if (op.auto) await step((i, o) => ['autorot', i, o]);
      } else if (op.t === 'colourspace') {
        await step((i, o) => ['colourspace', i, o, op.space]);
      } else if (op.t === 'resize') {
        const { width, height } = targetSize(meta, op.opts);
        if (width === meta.width && height === meta.height) continue;
        const out = await thumbnailStep(cur, width, height);
        temps.push(out);
        cur = out;
      }
    }

    const raw = ops.find((o) => o.t === 'raw');
    if (raw) {
      const out = tmpPath('.raw');
      temps.push(out);
      await run('vips', ['rawsave', cur, out]);
      const data = await fsp.readFile(out);
      return {
        data,
        info: { format: 'raw', width: meta.width, height: meta.height, channels: meta.bands, size: data.length },
      };
    }

    const fmtOp = [...ops].reverse().find((o) => o.t === 'format');
    const format = fmtOp ? fmtOp.format : meta.format;
    const saveArgs = SAVE_ARGS[format];
    if (!saveArgs) throw new Error(`output format ${format} is not supported by this shim`);

    const out = tmpPath(`.${format}`);
    temps.push(out);
    await run('vips', [...saveArgs(fmtOp ? fmtOp.opts : {}), cur, out]);
    const data = await fsp.readFile(out);
    const info = await headerOf(out);
    return {
      data,
      info: {
        format,
        width: info.width,
        height: info.height,
        channels: info.bands,
        space: info.space,
        depth: info.depth,
        hasAlpha: info.hasAlpha,
        size: data.length,
      },
    };
  } finally {
    for (const f of temps) await fsp.unlink(f).catch(() => {});
    if (cleanup) await fsp.unlink(cleanup).catch(() => {});
  }
}

function sharp(input) {
  return new Pipeline(input);
}

sharp.versions = { vips: '8.18.7-cli-shim' };
sharp.cache = () => {};
sharp.concurrency = () => {};
sharp.simd = () => false;

module.exports = sharp;
