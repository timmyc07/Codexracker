import { EventEmitter } from 'node:events'

/** Chromium's NUL-delimited CDP transport over inherited OS pipes. */
export class PipeConnection extends EventEmitter {
  constructor(read, write) {
    super()
    this.read = read
    this.write = write
    this.sequence = 0
    this.pending = new Map()
    this.buffer = Buffer.alloc(0)
    this.closed = false
    read.on('data', (chunk) => {
      try {
        this.buffer = Buffer.concat([this.buffer, chunk])
        if (this.buffer.length > 16 * 1024 * 1024) throw new Error('pipe-frame-too-large')
        for (let end; (end = this.buffer.indexOf(0)) >= 0;) {
          const message = JSON.parse(this.buffer.subarray(0, end).toString('utf8'))
          this.buffer = this.buffer.subarray(end + 1)
          const request = this.pending.get(message.id)
          if (request) {
            this.pending.delete(message.id)
            clearTimeout(request.timer)
            if (message.error) request.reject(new Error('pipe-command-rejected'))
            else request.resolve(message.result)
          } else if (message.method) this.emit('event', message)
        }
      } catch {
        this.close()
      }
    })
    read.on('close', () => this.close())
    read.on('error', () => this.close())
    write.on('error', () => this.close())
  }

  call(method, params = {}, sessionId) {
    if (this.closed) return Promise.reject(new Error('pipe-closed'))
    if (this.pending.size >= 1000) return Promise.reject(new Error('pipe-busy'))
    return new Promise((resolve, reject) => {
      const id = ++this.sequence
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error('pipe-command-timeout'))
      }, 15000)
      this.pending.set(id, { resolve, reject, timer })
      this.write.write(
        JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }) + '\0',
      )
    })
  }

  close() {
    if (this.closed) return
    this.closed = true
    for (const request of this.pending.values()) {
      clearTimeout(request.timer)
      request.reject(new Error('pipe-closed'))
    }
    this.pending.clear()
    this.buffer = Buffer.alloc(0)
    this.read.destroy()
    this.write.destroy()
    this.emit('close')
  }
}
