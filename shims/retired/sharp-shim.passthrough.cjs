/**
 * Android 上的 sharp 替代实现。
 *
 * 背景：sharp 的 optionalDependencies 里没有任何 android 包，加载时抛
 *   Could not load the "sharp" module using the android-arm64 runtime
 * 而 @deepseek-ai/dsh-attachment-local 依赖它读图片元数据、做归一化，
 * 所以手机上传图片一律失败。
 *
 * 本文件只做两件事：
 *   1. 用纯 JS 解析图片头部，返回 metadata（宽高、格式、位深、色彩空间、是否带 EXIF）
 *   2. 提供链式空操作，toBuffer 原样返回输入字节
 *
 * 为什么这样够用：dsh-attachment-local 里有个 canPassThroughNormalization()，
 * 只要图片没超限、不是 GIF、不动画、不带元数据、8 位 sRGB，就直接原样放行，
 * 根本不进 resize 管线。截图这类图片正好满足。
 *
 * 覆盖不到的：需要真正缩放/转码的大图或带 EXIF 的照片，会走到管线那步，
 * 而我们的 toBuffer 返回原字节，尺寸对不上，会被 verifyNormalizedImage 拒绝。
 * 那种情况报 ATTACHMENT_WRITE_FAILED，属于已知降级。
 *
 * 加载方式：NODE_OPTIONS=--require=<本文件>
 */
'use strict'

function detectPng(buf) {
  if (buf.length < 24) return null
  if (buf[0] !== 0x89 || buf[1] !== 0x50 || buf[2] !== 0x4e || buf[3] !== 0x47) return null
  const width = buf.readUInt32BE(16)
  const height = buf.readUInt32BE(20)
  const bitDepth = buf[24]
  const colorType = buf[25]
  // colorType: 0 灰度, 2 RGB, 3 调色板, 4 灰度+alpha, 6 RGBA
  const hasAlpha = colorType === 4 || colorType === 6 || colorType === 3
  return {
    format: 'png',
    width,
    height,
    depth: bitDepth === 16 ? 'ushort' : 'uchar',
    space: 'srgb',
    hasAlpha,
    pages: 1,
    channels: colorType === 2 ? 3 : colorType === 6 ? 4 : colorType === 0 ? 1 : colorType === 4 ? 2 : 4,
  }
}

function detectJpeg(buf) {
  if (buf.length < 4) return null
  if (buf[0] !== 0xff || buf[1] !== 0xd8) return null
  let offset = 2
  let hasExif = false
  while (offset + 4 < buf.length) {
    if (buf[offset] !== 0xff) {
      offset++
      continue
    }
    const marker = buf[offset + 1]
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2
      continue
    }
    if (marker === 0xda) break // SOS，后面是压缩数据
    const length = buf.readUInt16BE(offset + 2)
    if (marker === 0xe1) hasExif = true
    const isSof =
      (marker >= 0xc0 && marker <= 0xc3) ||
      (marker >= 0xc5 && marker <= 0xc7) ||
      (marker >= 0xc9 && marker <= 0xcb) ||
      (marker >= 0xcd && marker <= 0xcf)
    if (isSof && offset + 9 < buf.length) {
      const precision = buf[offset + 4]
      const height = buf.readUInt16BE(offset + 5)
      const width = buf.readUInt16BE(offset + 7)
      const channels = buf[offset + 9]
      if (width > 0 && height > 0) {
        return {
          format: 'jpeg',
          width,
          height,
          depth: precision === 16 ? 'ushort' : 'uchar',
          space: 'srgb',
          hasAlpha: false,
          pages: 1,
          channels,
          _exif: hasExif,
        }
      }
    }
    offset += 2 + length
  }
  return null
}

function detectGif(buf) {
  if (buf.length < 10) return null
  const sig = buf.toString('ascii', 0, 6)
  if (sig !== 'GIF87a' && sig !== 'GIF89a') return null
  const width = buf.readUInt16LE(6)
  const height = buf.readUInt16LE(8)
  let frames = 0
  for (let i = 0; i < buf.length - 1; i++) {
    if (buf[i] === 0x21 && buf[i + 1] === 0xf9) frames++
  }
  return {
    format: 'gif',
    width,
    height,
    depth: 'uchar',
    space: 'srgb',
    hasAlpha: true,
    pages: Math.max(frames, 1),
    channels: 4,
  }
}

function detectWebp(buf) {
  if (buf.length < 30) return null
  if (buf.toString('ascii', 0, 4) !== 'RIFF') return null
  if (buf.toString('ascii', 8, 12) !== 'WEBP') return null
  const chunk = buf.toString('ascii', 12, 16)
  if (chunk === 'VP8X' && buf.length >= 30) {
    const width = 1 + (buf.readUIntLE(24, 3) & 0xffffff)
    const height = 1 + (buf.readUIntLE(27, 3) & 0xffffff)
    return {
      format: 'webp',
      width,
      height,
      depth: 'uchar',
      space: 'srgb',
      hasAlpha: (buf[20] & 0x10) !== 0,
      pages: 1,
      channels: 4,
    }
  }
  if (chunk === 'VP8 ' && buf.length >= 30) {
    const width = buf.readUInt16LE(26) & 0x3fff
    const height = buf.readUInt16LE(28) & 0x3fff
    return { format: 'webp', width, height, depth: 'uchar', space: 'srgb', hasAlpha: false, pages: 1, channels: 3 }
  }
  if (chunk === 'VP8L' && buf.length >= 25) {
    const bits = buf.readUInt32LE(21)
    const width = (bits & 0x3fff) + 1
    const height = ((bits >> 14) & 0x3fff) + 1
    return { format: 'webp', width, height, depth: 'uchar', space: 'srgb', hasAlpha: true, pages: 1, channels: 4 }
  }
  return null
}

function parseMetadata(buf) {
  return detectPng(buf) || detectJpeg(buf) || detectGif(buf) || detectWebp(buf)
}

/* ---------- 链式空操作 ---------- */

const PASSTHROUGH_METHODS = [
  'rotate', 'flip', 'flop', 'resize', 'extend', 'extract', 'trim',
  'toColourspace', 'toColorspace', 'withMetadata', 'keepMetadata',
  'removeAlpha', 'ensureAlpha', 'flatten', 'negate', 'normalise', 'normalize',
  'linear', 'gamma', 'grayscale', 'greyscale', 'tint', 'sharpen', 'blur',
  'median', 'threshold', 'modulate', 'brightness', 'saturation', 'hue',
  'composite', 'affine', 'premultiply', 'unpremultiply', 'clahe', 'convolve',
  'recomb', 'bandbool', 'boolean', 'pipelineColourspace', 'pipelineColorspace',
  'raw', 'jpeg', 'jpg', 'png', 'webp', 'gif', 'avif', 'heif', 'tiff', 'jp2',
  'toFormat', 'withIccProfile', 'timeout', 'failOn', 'limitInputPixels',
  'sequentialRead', 'keepIccProfile',
]

function createPipeline(input) {
  let source = Buffer.isBuffer(input) ? input : Buffer.alloc(0)

  const pipeline = {
    _input: source,
    metadata: async () => {
      const parsed = parseMetadata(source) || {
        format: 'png',
        width: 1,
        height: 1,
        depth: 'uchar',
        space: 'srgb',
        hasAlpha: false,
        pages: 1,
        channels: 4,
      }
      const meta = {
        format: parsed.format,
        width: parsed.width,
        height: parsed.height,
        depth: parsed.depth,
        space: parsed.space,
        hasAlpha: parsed.hasAlpha,
        pages: parsed.pages,
        channels: parsed.channels,
        orientation: 1,
        density: 72,
        isProgressive: false,
        size: source.length,
      }
      if (parsed._exif) meta.exif = Buffer.from('Exif\0\0')
      return meta
    },
    stats: async () => ({ channels: [] }),
    toBuffer: async () => source,
    toFile: async () => ({ size: source.length, width: 0, height: 0, format: 'png' }),
    clone: () => createPipeline(source),
  }

  for (const name of PASSTHROUGH_METHODS) {
    if (pipeline[name]) continue
    pipeline[name] = function () {
      return this
    }
  }
  return pipeline
}

function sharp(input) {
  if (typeof input === 'string' || (input && typeof input === 'object' && !Buffer.isBuffer(input) && !ArrayBuffer.isView(input))) {
    // 路径或对象输入：没有源码可解析，返回空管线
    return createPipeline(Buffer.alloc(0))
  }
  return createPipeline(Buffer.from(input))
}

sharp.cache = () => {}
sharp.concurrency = () => 1
sharp.simd = () => false
sharp.versions = { vips: 'n/a-shim', sharp: 'shim' }
sharp.format = { jpeg: { input: true }, png: { input: true }, webp: { input: true }, gif: { input: true } }
sharp.queue = { on: () => {} }

module.exports = sharp
module.exports.default = sharp
module.exports._parseMetadata = parseMetadata

/* ---------- 拦截 require('sharp') ---------- */

const Module = require('node:module')
const originalLoad = Module._load
Module._load = function (request, parent, isMain) {
  if (request === 'sharp') return sharp
  return originalLoad.apply(this, arguments)
}
