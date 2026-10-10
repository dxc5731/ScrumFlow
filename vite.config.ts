import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { meetingLlmMiddleware } from './server/meetingLlm.ts'

// Vite config — https://vitejs.dev/config/
export default defineConfig(() => {
  return {
    base: '/',
    build: {
      sourcemap: false,
    },
    optimizeDeps: {
      include: ['mermaid', 'docx', 'jszip', 'xlsx', 'mammoth', 'dompurify', 'marked'],
    },
    test: {
      exclude: ['**/node_modules/**', '**/dist/**', '**/output/**'],
    },
    plugins: [
      localProjectPersistence(),
      {
        name: 'meeting-llm-adapter',
        configureServer(server) { server.middlewares.use(meetingLlmMiddleware) },
        configurePreviewServer(server) { server.middlewares.use(meetingLlmMiddleware) },
      },
      react(),
      tailwindcss(),
    ],
    resolve: {
      alias: {
        '@': path.resolve(import.meta.dirname, './src'),
      },
    },
    server: {
      host: '0.0.0.0',
      port: parseInt(process.env.PORT || '8443'),
      strictPort: true,
      watch: { ignored: ['**/output/**'] },
    },
    preview: {
      host: '0.0.0.0',
      port: parseInt(process.env.PORT || '8443'),
    },
  }
})

const MAX_PROJECT_STATE_BYTES = 25 * 1024 * 1024
const MAX_ASSET_BYTES = 5 * 1024 * 1024

async function readRequestBody(request: IncomingMessage, maxBytes: number) {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.length
    if (size > maxBytes) throw new Error('PAYLOAD_TOO_LARGE')
    chunks.push(buffer)
  }
  return Buffer.concat(chunks)
}

async function writeAtomically(filePath: string, content: string | Buffer) {
  await mkdir(path.dirname(filePath), { recursive: true })
  const temporaryPath = `${filePath}.${randomUUID()}.tmp`
  try {
    await writeFile(temporaryPath, content)
    // Windows 的索引/杀毒程序可能短暂占用目标文件；保留原子替换并有限重试。
    for (let attempt = 0; ; attempt++) {
      try { await rename(temporaryPath, filePath); break }
      catch (error) {
        if (attempt >= 3 || !['EPERM', 'EBUSY', 'EACCES'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error
        await new Promise(resolve => setTimeout(resolve, 50 * (attempt + 1)))
      }
    }
  } catch (error) {
    await rm(temporaryPath, { force: true }).catch(() => undefined)
    throw error
  }
}

function localProjectPersistence(): Plugin {
  const dataDirectory = path.resolve(process.env.PROJECT_DATA_DIRECTORY || path.join(import.meta.dirname, 'local-data'))
  const stateFile = path.join(dataDirectory, 'project-state.json')
  const assetDirectory = path.join(dataDirectory, 'assets')
  let stateWriteQueue = Promise.resolve()

  const sendError = (response: ServerResponse, status: number, message: string) => {
    response.statusCode = status
    response.setHeader('Content-Type', 'application/json; charset=utf-8')
    response.end(JSON.stringify({ error: message }))
  }

  const middleware = async (
    request: IncomingMessage,
    response: ServerResponse,
    next: (error?: unknown) => void,
  ) => {
    const requestPath = request.url?.split('?')[0] ?? ''
    if (requestPath !== '/api/local-project' && !requestPath.startsWith('/api/local-assets/')) {
      next()
      return
    }

    try {
      if (requestPath === '/api/local-project') {
        if (request.method === 'GET') {
          const content = await readFile(stateFile, 'utf8').catch((error: NodeJS.ErrnoException) => {
            if (error.code === 'ENOENT') return null
            throw error
          })
          if (content === null) return sendError(response, 404, '尚未保存项目数据')
          response.setHeader('Content-Type', 'application/json; charset=utf-8')
          response.end(content)
          return
        }
        if (request.method === 'PUT') {
          const body = await readRequestBody(request, MAX_PROJECT_STATE_BYTES)
          JSON.parse(body.toString('utf8'))
          stateWriteQueue = stateWriteQueue
            .catch(() => undefined)
            .then(() => writeAtomically(stateFile, body))
          await stateWriteQueue
          response.statusCode = 204
          response.end()
          return
        }
        if (request.method === 'DELETE') {
          stateWriteQueue = stateWriteQueue
            .catch(() => undefined)
            .then(() => rm(stateFile, { force: true }))
          await stateWriteQueue
          response.statusCode = 204
          response.end()
          return
        }
        return sendError(response, 405, '不支持的请求方法')
      }

      const key = decodeURIComponent(requestPath.slice('/api/local-assets/'.length))
      if (!/^blob-[a-zA-Z0-9-]+$/.test(key)) return sendError(response, 400, '附件标识无效')
      const assetFile = path.join(assetDirectory, `${key}.bin`)
      const metadataFile = path.join(assetDirectory, `${key}.json`)

      if (request.method === 'GET') {
        const content = await readFile(assetFile).catch((error: NodeJS.ErrnoException) => {
          if (error.code === 'ENOENT') return null
          throw error
        })
        if (content === null) return sendError(response, 404, '附件不存在')
        const metadata: { contentType?: string } = await readFile(metadataFile, 'utf8')
          .then((value) => JSON.parse(value) as { contentType?: string })
          .catch(() => ({}))
        response.setHeader('Content-Type', metadata.contentType || 'application/octet-stream')
        response.setHeader('Content-Length', content.length)
        response.end(content)
        return
      }
      if (request.method === 'PUT') {
        const content = await readRequestBody(request, MAX_ASSET_BYTES)
        const metadata = JSON.stringify({
          contentType: request.headers['content-type'] || 'application/octet-stream',
        })
        await Promise.all([
          writeAtomically(assetFile, content),
          writeAtomically(metadataFile, metadata),
        ])
        response.statusCode = 204
        response.end()
        return
      }
      if (request.method === 'DELETE') {
        await Promise.all([
          rm(assetFile, { force: true }),
          rm(metadataFile, { force: true }),
        ])
        response.statusCode = 204
        response.end()
        return
      }
      return sendError(response, 405, '不支持的请求方法')
    } catch (error) {
      if (error instanceof Error && error.message === 'PAYLOAD_TOO_LARGE') {
        sendError(response, 413, '请求内容超过大小限制')
        return
      }
      if (error instanceof SyntaxError) {
        sendError(response, 400, '项目数据不是有效 JSON')
        return
      }
      next(error)
    }
  }

  return {
    name: 'local-project-persistence',
    configureServer(server) {
      server.middlewares.use(middleware)
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware)
    },
  }
}
