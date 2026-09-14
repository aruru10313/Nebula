const fs = require('fs-extra')
const path = require('path')
const zlib = require('zlib')

const SERVER_ADDRESS = 'comet.aruru.kr'
const SERVER_NAME = 'Nebula Survival'
const MARKER_FILE = 'nebula-server-registration.json'

const TYPE_IDS = {
    end: 0,
    byte: 1,
    short: 2,
    int: 3,
    long: 4,
    float: 5,
    double: 6,
    byteArray: 7,
    string: 8,
    list: 9,
    compound: 10,
    intArray: 11,
    longArray: 12
}

const TYPE_NAMES = Object.fromEntries(Object.entries(TYPE_IDS).map(([name, id]) => [id, name]))

class NbtReader {
    constructor(buffer) {
        this.buffer = buffer
        this.offset = 0
    }

    ensure(size) {
        if(this.offset + size > this.buffer.length) {
            throw new Error('Unexpected end of servers.dat.')
        }
    }

    readByte() {
        this.ensure(1)
        return this.buffer.readInt8(this.offset++)
    }

    readUnsignedByte() {
        this.ensure(1)
        return this.buffer.readUInt8(this.offset++)
    }

    readShort() {
        this.ensure(2)
        const value = this.buffer.readInt16BE(this.offset)
        this.offset += 2
        return value
    }

    readInt() {
        this.ensure(4)
        const value = this.buffer.readInt32BE(this.offset)
        this.offset += 4
        return value
    }

    readLong() {
        this.ensure(8)
        const value = this.buffer.readBigInt64BE(this.offset)
        this.offset += 8
        return value
    }

    readFloat() {
        this.ensure(4)
        const value = this.buffer.readFloatBE(this.offset)
        this.offset += 4
        return value
    }

    readDouble() {
        this.ensure(8)
        const value = this.buffer.readDoubleBE(this.offset)
        this.offset += 8
        return value
    }

    readBytes(length) {
        if(length < 0) throw new Error('Invalid NBT array length.')
        this.ensure(length)
        const value = this.buffer.subarray(this.offset, this.offset + length)
        this.offset += length
        return Buffer.from(value)
    }

    readString() {
        this.ensure(2)
        const length = this.buffer.readUInt16BE(this.offset)
        this.offset += 2
        return this.readBytes(length).toString('utf8')
    }
}

function parsePayload(reader, typeId) {
    switch(typeId) {
        case TYPE_IDS.byte:
            return reader.readByte()
        case TYPE_IDS.short:
            return reader.readShort()
        case TYPE_IDS.int:
            return reader.readInt()
        case TYPE_IDS.long:
            return reader.readLong()
        case TYPE_IDS.float:
            return reader.readFloat()
        case TYPE_IDS.double:
            return reader.readDouble()
        case TYPE_IDS.byteArray: {
            const length = reader.readInt()
            return reader.readBytes(length)
        }
        case TYPE_IDS.string:
            return reader.readString()
        case TYPE_IDS.list: {
            const elementTypeId = reader.readUnsignedByte()
            const length = reader.readInt()
            if(length < 0) throw new Error('Invalid NBT list length.')
            const values = []
            for(let index = 0; index < length; index++) {
                values.push(parsePayload(reader, elementTypeId))
            }
            return {
                type: TYPE_NAMES[elementTypeId],
                value: values
            }
        }
        case TYPE_IDS.compound: {
            const value = {}
            while(true) {
                const childTypeId = reader.readUnsignedByte()
                if(childTypeId === TYPE_IDS.end) break
                const name = reader.readString()
                value[name] = {
                    type: TYPE_NAMES[childTypeId],
                    value: parsePayload(reader, childTypeId)
                }
            }
            return value
        }
        case TYPE_IDS.intArray: {
            const length = reader.readInt()
            if(length < 0) throw new Error('Invalid NBT int array length.')
            const value = []
            for(let index = 0; index < length; index++) value.push(reader.readInt())
            return value
        }
        case TYPE_IDS.longArray: {
            const length = reader.readInt()
            if(length < 0) throw new Error('Invalid NBT long array length.')
            const value = []
            for(let index = 0; index < length; index++) value.push(reader.readLong())
            return value
        }
        default:
            throw new Error(`Unsupported NBT tag type ${typeId}.`)
    }
}

function parseNbt(buffer) {
    const reader = new NbtReader(buffer)
    const typeId = reader.readUnsignedByte()
    if(typeId !== TYPE_IDS.compound) throw new Error('servers.dat root is not a compound tag.')
    return {
        type: 'compound',
        name: reader.readString(),
        value: parsePayload(reader, typeId)
    }
}

function encodeString(value) {
    const buffer = Buffer.from(value, 'utf8')
    if(buffer.length > 0xffff) throw new Error('NBT string is too long.')
    const length = Buffer.alloc(2)
    length.writeUInt16BE(buffer.length)
    return Buffer.concat([length, buffer])
}

function encodePayload(tag) {
    const typeId = TYPE_IDS[tag.type]
    if(typeId == null) throw new Error(`Unsupported NBT tag type ${tag.type}.`)
    const value = tag.value
    switch(typeId) {
        case TYPE_IDS.byte: {
            const buffer = Buffer.alloc(1)
            buffer.writeInt8(value)
            return buffer
        }
        case TYPE_IDS.short: {
            const buffer = Buffer.alloc(2)
            buffer.writeInt16BE(value)
            return buffer
        }
        case TYPE_IDS.int: {
            const buffer = Buffer.alloc(4)
            buffer.writeInt32BE(value)
            return buffer
        }
        case TYPE_IDS.long: {
            const buffer = Buffer.alloc(8)
            buffer.writeBigInt64BE(BigInt(value))
            return buffer
        }
        case TYPE_IDS.float: {
            const buffer = Buffer.alloc(4)
            buffer.writeFloatBE(value)
            return buffer
        }
        case TYPE_IDS.double: {
            const buffer = Buffer.alloc(8)
            buffer.writeDoubleBE(value)
            return buffer
        }
        case TYPE_IDS.byteArray: {
            const length = Buffer.alloc(4)
            length.writeInt32BE(value.length)
            return Buffer.concat([length, Buffer.from(value)])
        }
        case TYPE_IDS.string:
            return encodeString(value)
        case TYPE_IDS.list: {
            const elementTypeId = TYPE_IDS[value.type]
            const length = Buffer.alloc(4)
            length.writeInt32BE(value.value.length)
            return Buffer.concat([
                Buffer.from([elementTypeId]),
                length,
                ...value.value.map((entry) => encodePayload({ type: value.type, value: entry }))
            ])
        }
        case TYPE_IDS.compound: {
            const children = []
            for(const [name, child] of Object.entries(value)) {
                const childTypeId = TYPE_IDS[child.type]
                children.push(Buffer.from([childTypeId]), encodeString(name), encodePayload(child))
            }
            return Buffer.concat([...children, Buffer.from([TYPE_IDS.end])])
        }
        case TYPE_IDS.intArray: {
            const length = Buffer.alloc(4)
            length.writeInt32BE(value.length)
            return Buffer.concat([length, ...value.map((entry) => {
                const item = Buffer.alloc(4)
                item.writeInt32BE(entry)
                return item
            })])
        }
        case TYPE_IDS.longArray: {
            const length = Buffer.alloc(4)
            length.writeInt32BE(value.length)
            return Buffer.concat([length, ...value.map((entry) => {
                const item = Buffer.alloc(8)
                item.writeBigInt64BE(BigInt(entry))
                return item
            })])
        }
        default:
            throw new Error(`Unsupported NBT tag type ${tag.type}.`)
    }
}

function writeNbt(root) {
    return Buffer.concat([
        Buffer.from([TYPE_IDS.compound]),
        encodeString(root.name || ''),
        encodePayload(root)
    ])
}

function stringTag(value) {
    return { type: 'string', value }
}

function byteTag(value) {
    return { type: 'byte', value }
}

function createServerEntry() {
    return {
        name: stringTag(SERVER_NAME),
        ip: stringTag(SERVER_ADDRESS),
        hideAddress: byteTag(0)
    }
}

function createRoot() {
    return {
        type: 'compound',
        name: '',
        value: {
            servers: {
                type: 'list',
                value: {
                    type: 'compound',
                    value: []
                }
            }
        }
    }
}

function getServerEntries(root) {
    if (root == null || root.type !== 'compound' || root.value == null) {
        throw new Error('servers.dat root is not a compound tag.')
    }

    const servers = root.value.servers
    if (servers == null) {
        root.value.servers = createRoot().value.servers
        return root.value.servers.value.value
    }

    if (servers.type !== 'list' || servers.value?.type !== 'compound' || !Array.isArray(servers.value.value)) {
        throw new Error('servers.dat servers tag has an unexpected format.')
    }

    return servers.value.value
}

function getTagString(entry, key) {
    const tag = entry?.[key]
    return tag?.type === 'string' && typeof tag.value === 'string' ? tag.value : ''
}

function isGzip(buffer) {
    return buffer.length >= 2 && buffer[0] === 0x1f && buffer[1] === 0x8b
}

function writeAtomically(filePath, buffer) {
    const temporaryPath = `${filePath}.tmp-${process.pid}-${Date.now()}`
    try {
        fs.writeFileSync(temporaryPath, buffer, { mode: 0o600 })
        fs.renameSync(temporaryPath, filePath)
    } finally {
        if (fs.existsSync(temporaryPath)) {
            fs.removeSync(temporaryPath)
        }
    }
}

/**
 * Register Nebula's server once per instance. A marker preserves a user's
 * later deletion instead of re-adding the server on every launch.
 *
 * @param {string} gameDir Minecraft instance directory.
 * @returns {{ added: boolean, alreadyPresent: boolean, skipped: boolean }}
 */
function ensureNebulaServer(gameDir) {
    const markerPath = path.join(gameDir, MARKER_FILE)
    if (fs.existsSync(markerPath)) {
        return { added: false, alreadyPresent: false, skipped: true }
    }

    const serversPath = path.join(gameDir, 'servers.dat')
    const hadServersFile = fs.existsSync(serversPath)
    let sourceWasGzip = true
    let root = createRoot()

    if (hadServersFile) {
        const source = fs.readFileSync(serversPath)
        sourceWasGzip = isGzip(source)
            const uncompressed = sourceWasGzip ? zlib.gunzipSync(source) : source
            root = parseNbt(uncompressed)
    }

    const entries = getServerEntries(root)
    const normalizedAddress = SERVER_ADDRESS.toLowerCase()
    const alreadyPresent = entries.some((entry) => getTagString(entry, 'ip').trim().toLowerCase() === normalizedAddress)

    if (!alreadyPresent) {
        entries.push(createServerEntry())
        const uncompressed = writeNbt(root)
        const output = sourceWasGzip ? zlib.gzipSync(uncompressed) : uncompressed
        fs.ensureDirSync(gameDir)
        writeAtomically(serversPath, output)
    }

    writeAtomically(markerPath, Buffer.from(JSON.stringify({
        address: SERVER_ADDRESS,
        registeredAt: new Date().toISOString(),
        version: 1
    }, null, 2) + '\n'))

    return { added: !alreadyPresent, alreadyPresent, skipped: false }
}

module.exports = {
    ensureNebulaServer,
    SERVER_ADDRESS,
    SERVER_NAME
}
