const path = require('node:path')
const crypto = require('node:crypto')
const { promisify } = require('node:util')
const { createWriteStream } = require('node:fs')
const fs = require('node:fs/promises')
const { pipeline } = require('node:stream/promises')
const Fastify = require('fastify')
const helmet = require('@fastify/helmet')
const multipart = require('@fastify/multipart')
const rateLimit = require('@fastify/rate-limit')
const fastifyStatic = require('@fastify/static')
const { PrismaClient } = require('@prisma/client')
const { authenticator } = require('otplib')
const QRCode = require('qrcode')

const required = ['DATABASE_URL', 'SESSION_SECRET', 'TOTP_ENCRYPTION_KEY', 'ADMIN_LOGIN_ID', 'ADMIN_SETUP_TOKEN']
for (const name of required) {
    if (!process.env[name]) throw new Error(`${name} is required`)
}

const app = Fastify({ logger: true, trustProxy: process.env.TRUST_PROXY !== 'false' })
const prisma = new PrismaClient()
const port = Number(process.env.PORT || 3000)
const sessionTtlMs = 8 * 60 * 60 * 1000
const cookieOptions = {
    httpOnly: true,
    sameSite: 'strict',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    ...(process.env.COOKIE_DOMAIN ? { domain: process.env.COOKIE_DOMAIN } : {})
}
const adminLoginId = process.env.ADMIN_LOGIN_ID.trim()
const adminSetupToken = process.env.ADMIN_SETUP_TOKEN
const scrypt = promisify(crypto.scrypt)
const announcementImageDirectory = path.join(__dirname, 'data', 'announcement-images')

function hash(value) {
    return crypto.createHmac('sha256', process.env.SESSION_SECRET).update(value).digest('hex')
}

function randomToken(size = 32) {
    return crypto.randomBytes(size).toString('base64url')
}

function safeEqual(left, right) {
    const leftBuffer = Buffer.from(String(left))
    const rightBuffer = Buffer.from(String(right))
    return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer)
}

async function hashPassword(password) {
    const salt = crypto.randomBytes(16)
    const derived = await scrypt(password, salt, 32, { N: 16384, r: 8, p: 1 })
    return `scrypt$${salt.toString('base64url')}$${Buffer.from(derived).toString('base64url')}`
}

async function verifyPassword(password, encoded) {
    if (typeof encoded !== 'string') return false
    const [scheme, saltValue, hashValue] = encoded.split('$')
    if (scheme !== 'scrypt' || !saltValue || !hashValue) return false
    const salt = Buffer.from(saltValue, 'base64url')
    const expected = Buffer.from(hashValue, 'base64url')
    const actual = Buffer.from(await scrypt(password, salt, expected.length, { N: 16384, r: 8, p: 1 }))
    return expected.length === actual.length && crypto.timingSafeEqual(expected, actual)
}

function encryptionKey() {
    return crypto.createHash('sha256').update(process.env.TOTP_ENCRYPTION_KEY).digest()
}

function encrypt(value) {
    const iv = crypto.randomBytes(12)
    const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(), iv)
    const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
    return `${iv.toString('base64url')}.${cipher.getAuthTag().toString('base64url')}.${encrypted.toString('base64url')}`
}

function decrypt(value) {
    const [iv, tag, data] = value.split('.')
    const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(iv, 'base64url'))
    decipher.setAuthTag(Buffer.from(tag, 'base64url'))
    return Buffer.concat([decipher.update(Buffer.from(data, 'base64url')), decipher.final()]).toString('utf8')
}

function cleanText(value, max) {
    if (typeof value !== 'string') return null
    const normalized = value.normalize('NFC').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim()
    return normalized && normalized.length <= max ? normalized : null
}

function validDate(value) {
    const date = new Date(value)
    return typeof value === 'string' && !Number.isNaN(date.valueOf()) ? date : null
}

function validImageUrl(value) {
    if (value == null || value === '') return null
    if (typeof value !== 'string' || value.length > 1000) return null
    if (/^\/news-assets\/[A-Za-z0-9_-]+\.(?:png|jpe?g|webp|gif)$/i.test(value)) return value
    try {
        const parsed = new URL(value)
        return parsed.protocol === 'https:' ? parsed.toString() : null
    } catch {
        return null
    }
}

function validFontSize(value) {
    return Number.isInteger(value) && value >= 12 && value <= 32 ? value : null
}

async function createSession(adminUserId, stage) {
    const token = randomToken()
    const csrfToken = randomToken(24)
    await prisma.session.create({
        data: { tokenHash: hash(token), csrfToken, stage, adminUserId, expiresAt: new Date(Date.now() + sessionTtlMs) }
    })
    return { token, csrfToken }
}

async function currentSession(request) {
    const token = request.cookies.nebula_session
    if (!token) return null
    const session = await prisma.session.findUnique({ where: { tokenHash: hash(token) }, include: { adminUser: true } })
    if (!session) return null
    if (session.expiresAt <= new Date()) {
        await prisma.session.delete({ where: { id: session.id } }).catch(() => {})
        return null
    }
    return { ...session, token }
}

async function requireSession(request, reply, stages = ['authenticated']) {
    const session = await currentSession(request)
    if (!session || !stages.includes(session.stage)) {
        reply.code(401).send({ error: '인증이 필요합니다.' })
        return null
    }
    return session
}

async function requireCsrf(request, reply, session) {
    if (!session || request.headers['x-csrf-token'] !== session.csrfToken) {
        reply.code(403).send({ error: 'CSRF 토큰이 유효하지 않습니다.' })
        return false
    }
    return true
}

function setSessionCookie(reply, token) {
    reply.setCookie('nebula_session', token, { ...cookieOptions, maxAge: sessionTtlMs / 1000 })
}

async function configuredAdmin() {
    return prisma.adminUser.findUnique({ where: { loginId: adminLoginId } })
}

async function start() {
    await app.register(helmet, {
        contentSecurityPolicy: {
            directives: {
                defaultSrc: ["'self'"],
                imgSrc: ["'self'", 'data:', 'https:'],
                styleSrc: ["'self'"],
                scriptSrc: ["'self'"],
                connectSrc: ["'self'"],
                baseUri: ["'self'"],
                frameAncestors: ["'none'"]
            }
        },
        referrerPolicy: { policy: 'no-referrer' }
    })
    await app.register(rateLimit, { max: 120, timeWindow: '1 minute', ban: 2 })
    await app.register(require('@fastify/cookie'))
    await app.register(multipart, { limits: { files: 1, fileSize: 5 * 1024 * 1024 } })
    await fs.mkdir(announcementImageDirectory, { recursive: true })
    await app.register(fastifyStatic, {
        root: path.join(__dirname, 'admin-dist'),
        prefix: '/aruru/admin/'
    })
    await app.register(fastifyStatic, {
        root: announcementImageDirectory,
        prefix: '/news-assets/',
        decorateReply: false,
        index: false,
        setHeaders: (reply) => {
            reply.header('Cross-Origin-Resource-Policy', 'cross-origin')
        }
    })

    app.addHook('onRequest', async (request, reply) => {
        if (process.env.NODE_ENV === 'production' && request.url !== '/healthz' && request.headers['x-forwarded-proto'] !== 'https') {
            const host = request.headers.host
            return reply.redirect(`https://${host}${request.url}`)
        }
    })

    app.get('/healthz', async () => ({ ok: true }))
    app.get('/aruru/admin/', async (request, reply) => reply.sendFile('index.html'))
    app.get('/aruru/admin', async (request, reply) => reply.redirect('/aruru/admin/'))

    app.get('/auth/status', async (request, reply) => {
        reply.header('cache-control', 'no-store')
        const session = await currentSession(request)
        if (!session) {
            const user = await configuredAdmin()
            return {
                authenticated: false,
                requiresTotp: Boolean(user?.passwordHash && user?.totpSecretEncrypted),
                setupRequired: !user?.passwordHash || !user?.totpSecretEncrypted,
                loginId: user?.loginId || adminLoginId
            }
        }
        return {
            authenticated: session.stage === 'authenticated',
            requiresTotp: session.stage === '2fa',
            setupRequired: session.stage === 'setup',
            csrfToken: session.csrfToken,
            loginId: session.adminUser.loginId
        }
    })

    app.post('/auth/login', {
        config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
        schema: {
            body: {
                type: 'object',
                required: ['loginId', 'password'],
                additionalProperties: false,
                properties: {
                    loginId: { type: 'string', minLength: 1, maxLength: 120 },
                    password: { type: 'string', minLength: 12, maxLength: 200 }
                }
            }
        }
    }, async (request, reply) => {
        const user = await configuredAdmin()
        const loginMatches = safeEqual(request.body.loginId.trim(), adminLoginId)
        const valid = user?.passwordHash && loginMatches
            ? await verifyPassword(request.body.password, user.passwordHash)
            : false
        if (!valid || !user?.totpSecretEncrypted) return reply.code(401).send({ error: '관리자 ID 또는 비밀번호가 올바르지 않습니다.' })
        const session = await createSession(user.id, '2fa')
        setSessionCookie(reply, session.token)
        return { authenticated: false, requiresTotp: true, csrfToken: session.csrfToken }
    })

    app.post('/auth/totp/setup', {
        config: { rateLimit: { max: 5, timeWindow: '10 minutes' } },
        schema: {
            body: {
                type: 'object',
                required: ['setupToken', 'password'],
                additionalProperties: false,
                properties: {
                    setupToken: { type: 'string', minLength: 1, maxLength: 200 },
                    password: { type: 'string', minLength: 12, maxLength: 200 }
                }
            }
        }
    }, async (request, reply) => {
        if (!safeEqual(request.body.setupToken, adminSetupToken)) return reply.code(401).send({ error: '설정 토큰이 올바르지 않습니다.' })
        const existing = await configuredAdmin()
        if (existing?.passwordHash && existing?.totpSecretEncrypted) return reply.code(409).send({ error: '관리자 인증이 이미 설정되어 있습니다.' })
        const password = request.body.password
        if (typeof password !== 'string' || password.length < 12 || password.length > 200) {
            return reply.code(400).send({ error: '비밀번호는 12자 이상이어야 합니다.' })
        }
        const user = existing || await prisma.adminUser.create({ data: { loginId: adminLoginId } })
        const secret = existing?.totpSecretEncrypted ? decrypt(existing.totpSecretEncrypted) : authenticator.generateSecret()
        await prisma.adminUser.update({
            where: { id: user.id },
            data: { passwordHash: existing?.passwordHash || await hashPassword(password), totpSecretEncrypted: encrypt(secret) }
        })
        const session = await createSession(user.id, 'setup')
        setSessionCookie(reply, session.token)
        const otpauth = authenticator.keyuri(adminLoginId, 'Nebula Admin', secret)
        return { secret, qrCode: await QRCode.toDataURL(otpauth), csrfToken: session.csrfToken }
    })

    app.get('/auth/totp/setup', async (request, reply) => {
        reply.header('cache-control', 'no-store')
        const session = await requireSession(request, reply, ['setup'])
        if (!session) return
        const secret = session.adminUser.totpSecretEncrypted ? decrypt(session.adminUser.totpSecretEncrypted) : null
        if (!secret) return reply.code(400).send({ error: 'TOTP 설정을 시작하세요.' })
        const otpauth = authenticator.keyuri(session.adminUser.loginId, 'Nebula Admin', secret)
        return { secret, qrCode: await QRCode.toDataURL(otpauth) }
    })

    app.post('/auth/totp/verify', {
        config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
        schema: { body: { type: 'object', required: ['code'], additionalProperties: false, properties: { code: { type: 'string', pattern: '^[0-9]{6}$' } } } }
    }, async (request, reply) => {
        const session = await requireSession(request, reply, ['setup', '2fa'])
        if (!session || !(await requireCsrf(request, reply, session))) return
        if (!session.adminUser.totpSecretEncrypted) return reply.code(400).send({ error: '먼저 TOTP를 설정하세요.' })
        let valid = false
        try { valid = authenticator.check(request.body.code, decrypt(session.adminUser.totpSecretEncrypted)) } catch {}
        if (!valid) return reply.code(401).send({ error: '인증 코드가 올바르지 않습니다.' })
        await prisma.session.update({ where: { id: session.id }, data: { stage: 'authenticated', expiresAt: new Date(Date.now() + sessionTtlMs) } })
        return { authenticated: true, csrfToken: session.csrfToken }
    })

    app.post('/auth/logout', async (request, reply) => {
        const session = await currentSession(request)
        if (session && await requireCsrf(request, reply, session)) await prisma.session.delete({ where: { id: session.id } })
        reply.clearCookie('nebula_session', cookieOptions)
        return { ok: true }
    })

    app.get('/api/v1/news', { config: { rateLimit: { max: 180, timeWindow: '1 minute' } } }, async (request, reply) => {
        reply.header('access-control-allow-origin', '*')
            .header('access-control-allow-methods', 'GET')
            .header('access-control-allow-headers', 'accept, if-none-match')
        const requestedLimit = Number(request.query.limit || 20)
        const limit = Number.isInteger(requestedLimit) ? Math.min(Math.max(requestedLimit, 1), 50) : 20
        const announcements = await prisma.announcement.findMany({
            where: { publishedAt: { lte: new Date() } },
            orderBy: { publishedAt: 'desc' },
            take: limit,
            select: { id: true, title: true, body: true, imageUrl: true, fontSize: true, publishedAt: true, updatedAt: true }
        })
        const payload = JSON.stringify({ announcements })
        const etag = `"${hash(payload).slice(0, 32)}"`
        reply.header('cache-control', 'public, max-age=60, stale-while-revalidate=300').header('etag', etag)
        if (request.headers['if-none-match'] === etag) return reply.code(304).send()
        return { announcements }
    })

    const adminList = { config: { rateLimit: { max: 120, timeWindow: '1 minute' } } }
    app.get('/api/v1/admin/announcements', adminList, async (request, reply) => {
        const session = await requireSession(request, reply)
        if (!session) return
        return { announcements: await prisma.announcement.findMany({ orderBy: { publishedAt: 'desc' }, take: 100 }) }
    })
    app.post('/api/v1/admin/uploads/image', {
        config: { rateLimit: { max: 20, timeWindow: '10 minutes' } }
    }, async (request, reply) => {
        const session = await requireSession(request, reply)
        if (!session || !(await requireCsrf(request, reply, session))) return
        const file = await request.file()
        const extensions = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' }
        const extension = file && extensions[file.mimetype]
        if (!file || !extension) return reply.code(400).send({ error: 'PNG, JPG, WEBP, GIF 이미지만 업로드할 수 있습니다.' })
        const filename = `${randomToken(18)}.${extension}`
        const destination = path.join(announcementImageDirectory, filename)
        try {
            await pipeline(file.file, createWriteStream(destination, { flags: 'wx' }))
            if (file.file.truncated) {
                await fs.rm(destination, { force: true })
                return reply.code(413).send({ error: '이미지는 5MB 이하만 업로드할 수 있습니다.' })
            }
        } catch (error) {
            await fs.rm(destination, { force: true }).catch(() => {})
            throw error
        }
        return { url: `/news-assets/${filename}` }
    })
    const announcementSchema = {
        body: {
            type: 'object',
            required: ['title', 'body', 'publishedAt'],
            additionalProperties: false,
            properties: {
                title: { type: 'string', minLength: 1, maxLength: 160 },
                body: { type: 'string', minLength: 1, maxLength: 10000 },
                imageUrl: { type: 'string', maxLength: 1000 },
                fontSize: { type: 'integer', minimum: 12, maximum: 32 },
                publishedAt: { type: 'string', format: 'date-time' }
            }
        }
    }
    app.post('/api/v1/admin/announcements', { ...adminList, schema: announcementSchema }, async (request, reply) => {
        const session = await requireSession(request, reply)
        if (!session || !(await requireCsrf(request, reply, session))) return
        const title = cleanText(request.body.title, 160)
        const body = cleanText(request.body.body, 10000)
        const imageUrl = validImageUrl(request.body.imageUrl)
        const fontSize = validFontSize(request.body.fontSize)
        const publishedAt = validDate(request.body.publishedAt)
        if (!title || !body || !publishedAt || fontSize == null || (request.body.imageUrl && !imageUrl)) return reply.code(400).send({ error: '입력값이 올바르지 않습니다.' })
        return reply.code(201).send({ announcement: await prisma.announcement.create({ data: { title, body, imageUrl, fontSize, publishedAt, authorId: session.adminUserId } }) })
    })
    app.put('/api/v1/admin/announcements/:id', { ...adminList, schema: announcementSchema }, async (request, reply) => {
        const session = await requireSession(request, reply)
        if (!session || !(await requireCsrf(request, reply, session))) return
        const title = cleanText(request.body.title, 160)
        const body = cleanText(request.body.body, 10000)
        const imageUrl = validImageUrl(request.body.imageUrl)
        const fontSize = validFontSize(request.body.fontSize)
        const publishedAt = validDate(request.body.publishedAt)
        if (!title || !body || !publishedAt || fontSize == null || (request.body.imageUrl && !imageUrl)) return reply.code(400).send({ error: '입력값이 올바르지 않습니다.' })
        try {
            return { announcement: await prisma.announcement.update({ where: { id: request.params.id }, data: { title, body, imageUrl, fontSize, publishedAt } }) }
        } catch { return reply.code(404).send({ error: '공지를 찾을 수 없습니다.' }) }
    })
    app.delete('/api/v1/admin/announcements/:id', adminList, async (request, reply) => {
        const session = await requireSession(request, reply)
        if (!session || !(await requireCsrf(request, reply, session))) return
        try { await prisma.announcement.delete({ where: { id: request.params.id } }); return reply.code(204).send() } catch { return reply.code(404).send({ error: '공지를 찾을 수 없습니다.' }) }
    })

    app.setErrorHandler((error, request, reply) => {
        if (error.validation) return reply.code(400).send({ error: '입력값이 올바르지 않습니다.' })
        request.log.error(error)
        return reply.code(500).send({ error: '서버 오류가 발생했습니다.' })
    })
    await app.listen({ port, host: '0.0.0.0' })
}

start().catch(async (error) => {
    app.log.error(error)
    await prisma.$disconnect()
    process.exit(1)
})
