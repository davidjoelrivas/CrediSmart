import { randomInt } from "node:crypto";
import type { VerificationCodeGenerator } from "../../../modules/collections/application/ports";

/** Sin 0, O, 1, I ni L para que el código se pueda leer y dictar sin confusiones. */
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 24;

/** Código aleatorio de 24 caracteres (unos 118 bits) para el QR del recibo. */
export class RandomVerificationCodes implements VerificationCodeGenerator {
  newCode(): string {
    let code = "";
    for (let index = 0; index < CODE_LENGTH; index++) {
      code += ALPHABET[randomInt(ALPHABET.length)];
    }
    return code;
  }
}
