import { generateKeyPair } from "../shared/infrastructure/crypto/field-cipher";

const keys = generateKeyPair();
console.log("Copiá estas dos líneas en tu archivo .env (cada entorno debe tener sus propias llaves):\n");
console.log(`FIELD_ENCRYPTION_KEY=${keys.FIELD_ENCRYPTION_KEY}`);
console.log(`FIELD_HASH_KEY=${keys.FIELD_HASH_KEY}`);
console.log("\nGuardá una copia de estas llaves en un lugar seguro: si se pierden, los datos cifrados no se pueden recuperar.");
