/**
 * Android 文件系统垫片。
 *
 * 实测：Android 的应用数据目录不支持硬链接（ln 和 fs.link 都返回
 * Permission denied / EACCES）。
 *
 * DSH 有几处用 link() 做原子发布：
 *   @deepseek-ai/dsh-session-persistence-jsonl  写会话日志
 *   @deepseek-ai/dsh-attachment-local           发布附件对象
 *
 * 兜底为什么是 copyFile 而不是 rename：
 *   调用方是「link(src, dst) → unlink(src)」这套惯用法，期望 link 之后
 *   两个名字都在。rename 会把 src 移走，紧接着的 unlink(src) 就 ENOENT，
 *   整次写入被包成 ATTACHMENT_WRITE_FAILED（实测踩过）。
 *   copyFile + COPYFILE_EXCL 才是等价语义：dst 出现、src 保留、
 *   dst 已存在时照样 EEXIST。
 *
 * 代价：多一次字节拷贝（不是同 inode 的别名）。手机单用户场景可接受。
 *
 * 必须先抓原始引用再替换，否则补丁函数内部再次调用同名方法会自我递归。
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
const originalCopyFileSync = fs.copyFileSync
const originalCopyFile = fs.copyFile
const originalFspLink = fsp.link
const originalFspCopyFile = fsp.copyFile
const COPYFILE_EXCL = fs.constants.COPYFILE_EXCL

const patchedLinkSync = function patchedLinkSync(existingPath, newPath) {
  try {
    return originalLinkSync.call(fs, existingPath, newPath)
  } catch (error) {
    if (!shouldFallback(error)) throw error
    return originalCopyFileSync.call(fs, existingPath, newPath, COPYFILE_EXCL)
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
    originalCopyFile.call(fs, existingPath, newPath, COPYFILE_EXCL, callback)
  })
}

const patchedFspLink = async function patchedFspLink(existingPath, newPath) {
  try {
    return await originalFspLink.call(fsp, existingPath, newPath)
  } catch (error) {
    if (!shouldFallback(error)) throw error
    return await originalFspCopyFile.call(fsp, existingPath, newPath, COPYFILE_EXCL)
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
