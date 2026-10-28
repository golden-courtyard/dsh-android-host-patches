'use strict';
/**
 * 启动钩子：把 require('sharp') 指向 libvips CLI 后端。
 *
 * 历史：2026-10-28 用的是 ~/.dsh/sharp-shim.cjs —— 纯 JS 解头部 +
 * 原字节直通，只够让 attachment 入库通过（canPassThroughNormalization），
 * 撑不起发给模型前的真实缩放，大图会报 ATTACHMENT_WRITE_FAILED。
 * 已留档在 shims/retired/sharp-shim.passthrough.cjs。
 *
 * 现在后端是 shims/sharp/index.cjs（vips 命令行做像素工作），落在
 * dsh 的 node_modules/sharp。这个钩子仍然保留，因为 NODE_OPTIONS 是
 * 本机唯一稳定的注入点；它只做转发，不再自己实现任何图像逻辑。
 *
 * 生效条件：dsh 进程重启（NODE_OPTIONS 在一次进程生命周期内不变）。
 */

const path = require('node:path');
const Module = require('node:module');

const PREFIX = process.env.PREFIX || '/data/data/com.termux/files/usr';
const BACKEND = path.join(
  PREFIX,
  'lib/node_modules/@deepseek-ai/dsh/node_modules/sharp/index.cjs',
);

const sharp = require(BACKEND);
const originalLoad = Module._load;

Module._load = function patchedLoad(request, parent, isMain) {
  if (request === 'sharp') return sharp;
  return originalLoad.apply(this, arguments);
};

module.exports = sharp;
