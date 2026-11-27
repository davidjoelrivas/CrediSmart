import { createCipheriv, createDecipheriv, createHmac, randomBytes } from "node:crypto";

const VERSION = 1;
const IV_LENGTH = 12;
const TAG_LENGTH = 16;
const KEY_LENGTH = 32;

export class FieldCipherError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FieldCipherError";
  }
}

function keyFrom(base64: string | undefined, name: string): Buffer {
  if (!base64) {
    throw new FieldCipherError(`Falta la variable de entorno ${name}. Generala con "pnpm keys:generate".`);
  }
  const key = Buffer.from(base64, "base64");
  if (key.length !== KEY_LENGTH) {
    throw new FieldCipherError(`${name} debe ser una llave de ${KEY_LENGTH} bytes codificada en base64.`);
  }
  return key;
}

/**
 * Cifrado de datos sensibles a nivel de campo (por ejemplo el DNI de un cliente) con AES-256-GCM.
 * Aunque alguien obtuviera una copia de la base de datos, sin la llave no puede leer esos campos.
 *
 * - `encrypt` produce siempre un resultado distinto (IV aleatorio) y `decrypt` detecta cualquier alteración.
 * - `searchHash` permite buscar o evitar duplicados sin descifrar: es un HMAC con una llave aparte.
 */
export class FieldCipher {
  constructor(
    private readonly encryptionKey: Buffer,
    private readonly hashKey: Buffer,
  ) {
    if (encryptionKey.length !== KEY_LENGTH || hashKey.length !== KEY_LENGTH) {
      throw new FieldCipherError(`Las llaves deben tener ${KEY_LENGTH} bytes.`);
    }
    if (encryptionKey.equals(hashKey)) {
      throw new FieldCipherError("La llave de cifrado y la de búsqueda deben ser distintas.");
    }
  }

  static fromEnv(env: NodeJS.ProcessEnv = process.env): FieldCipher {
    return new FieldCipher(
      keyFrom(env.FIELD_ENCRYPTION_KEY, "FIELD_ENCRYPTION_KEY"),
      keyFrom(env.FIELD_HASH_KEY, "FIELD_HASH_KEY"),
    );
  }

  /** Formato: versión (1 byte) + IV (12) + etiqueta de autenticación (16) + texto cifrado. */
  encrypt(plainText: string): Buffer {
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv("aes-256-gcm", this.encryptionKey, iv);
    const encrypted = Buffer.concat([cipher.update(plainText, "utf8"), cipher.final()]);
    return Buffer.concat([Buffer.from([VERSION]), iv, cipher.getAuthTag(), encrypted]);
  }

  decrypt(data: Buffer): string {
    if (data.length < 1 + IV_LENGTH + TAG_LENGTH || data[0] !== VERSION) {
      throw new FieldCipherError("El dato cifrado tiene un formato inválido.");
    }
    const iv = data.subarray(1, 1 + IV_LENGTH);
    const tag = data.subarray(1 + IV_LENGTH, 1 + IV_LENGTH + TAG_LENGTH);
    const encrypted = data.subarray(1 + IV_LENGTH + TAG_LENGTH);
    try {
      const decipher = createDecipheriv("aes-256-gcm", this.encryptionKey, iv);
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
    } catch {
      throw new FieldCipherError("No se pudo descifrar: la llave no corresponde o el dato fue alterado.");
    }
  }

  /** Huella estable para buscar: ignora mayúsculas, espacios y guiones (0801-1990-12345 = 0801199012345). */
  searchHash(value: string): string {
    const normalized = value.replace(/[\s-]/g, "").toUpperCase();
    return createHmac("sha256", this.hashKey).update(normalized).digest("hex");
  }
}

/** Dos llaves nuevas, listas para pegar en el archivo .env. */
export function generateKeyPair(): { FIELD_ENCRYPTION_KEY: string; FIELD_HASH_KEY: string } {
  return {
    FIELD_ENCRYPTION_KEY: randomBytes(KEY_LENGTH).toString("base64"),
    FIELD_HASH_KEY: randomBytes(KEY_LENGTH).toString("base64"),
  };
}
