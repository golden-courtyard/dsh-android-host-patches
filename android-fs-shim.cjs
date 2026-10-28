/**
 * Android 文件系统垫片。
 *
 * 实测：Android 的应用数据目录不支持硬链接（ln 和 fs.link 都返回
 * Permission denied / EACCES）。
 *
 * DSH 有几处用 link() 做"创建但不覆盖"的原子发布：
 *   - @deepseek-ai/dsh-session-persistence-jsonl  写会话日志（promise 版）
 *   - @deepseek-ai/dsh-app-boot
 *   - @deepseek-ai/dsh-subprocess-local
 *
 * 这里覆盖三种调用形态：fs.linkSync / fs.link（回调）/ fs.promises.link。
 * 先试硬链接，失败则 rename。
 *
 * 必须先抓原始引用再替换，否则补丁函数内部再次调用同名方法会自我递归。
 *
 * 语义差异：rename 覆盖已存在的目标，link 会 EEXIST。调用点通常已先确认
 * 目标不存在（如 rejectExistingLog），单实例场景下可接受。
 */
'use strict'

const fs = require('node:fs')
const fsp = require('node:fs/promises')

const FALLBACK_CODES = new Set(['EACCES', 'EPERM', 'ENOSYS', 'EXDEV', 'EMLINK', 'EOPNOTSUPP'])

function shouldFallback(error) {
  return error != null && FALLBACK_CODES.has(error.code)
}

/* 先抓原始引用。顺序不能反。 */
const originalLinkSync = fs.linkSync
const originalLink = fs.link
const originalRenameSync = fs.renameSync
const originalRename = fs.rename
const originalFspLink = fsp.link
const originalFspRename = fsp.rename

const patchedLinkSync = function patchedLinkSync(existingPath, newPath) {
  try {
    return originalLinkSync.call(fs, existingPath, newPath)
  } catch (error) {
    if (!shouldFallback(error)) throw error
    return originalRenameSync.call(fs, existingPath, newPath)
  }
}

const patchedLink = function patchedLink(existingPath, newPath, callback) {
  if (typeof callback !== 'function') {
    return originalLink.call(fs, existingPath, newPath, callback)
  }
  return originalLink.call(fs, existingPath, newPath, (error) => {
    if (error == null || !shouldFallback(error)) {
      callback(error)
      return
    }
    originalRename.call(fs, existingPath, newPath, callback)
  })
}

const patchedFspLink = async function patchedFspLink(existingPath, newPath) {
  try {
    return await originalFspLink.call(fsp, existingPath, newPath)
  } catch (error) {
    if (!shouldFallback(error)) throw error
    return await originalFspRename.call(fsp, existingPath, newPath)
  }
}

try {
  fs.linkSync = patchedLinkSync
} catch {}
try {
  fs.link = patchedLink
} catch {}
try {
  fsp.link = patchedFspLink
} catch {}
try {
  if (fs.promises !== fsp) fs.promises.link = patchedFspLink
} catch {}
