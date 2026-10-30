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
 * dsh 的 node_modules/sharp。
 *
 * 本文件保留，但**当前不被引用** —— 手机端 .bashrc 的 NODE_OPTIONS 已收敛为
 * 只带 android-fs-shim。
 *
 * 为什么不靠它：2026-10-29 在 dsh 进程内实测，require('sharp') 没有经过这个
 * 钩子（记录见 agent-hub issue #3）。钩子机制本身成立——同样的 NODE_OPTIONS
 * 在独立进程里、CJS 与 ESM 两种入口都能拦截——但在这台机器的 dsh 进程里没观察
 * 到生效，根因未复现。而"直接替换 node_modules/sharp"已多次实证有效，故选后者。
 *
 * 若将来要再试钩子：先确认 ① 进程启动时 NODE_OPTIONS 确实指向本文件；
 * ② 该文件当时的 sha256 与预期一致（并行改动容易串版本）。
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
