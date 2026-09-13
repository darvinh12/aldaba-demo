// Uso: node scripts/gen-hash.mjs "LaClave"
const pw = process.argv[2]
// Piso de 8 en este repo de DEMOSTRACIÓN: la clave pública de la demo es Demo1234.
// En el producto real el mínimo lo impone el worker en /api/registro (10 caracteres).
if (!pw || pw.length < 8) { console.error('clave de 8+ caracteres requerida'); process.exit(1) }
const enc = new TextEncoder()
const salt = crypto.getRandomValues(new Uint8Array(16))
const key = await crypto.subtle.importKey('raw', enc.encode(pw), 'PBKDF2', false, ['deriveBits'])
const bits = new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 100000 }, key, 256))
const b64 = (b) => Buffer.from(b).toString('base64')
console.log(`100000$${b64(salt)}$${b64(bits)}`)
