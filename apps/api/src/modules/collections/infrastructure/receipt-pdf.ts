import PDFDocument from "pdfkit";
import QRCode from "qrcode";
import { longDate } from "../../../shared/infrastructure/spanish-dates";
import type { ReceiptView } from "../application/receipt-queries";

const METHOD_LABELS: Record<string, string> = {
  CASH: "Efectivo",
  TRANSFER: "Transferencia",
};

function lempiras(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const absolute = Math.abs(cents);
  const whole = Math.floor(absolute / 100)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${sign}L ${whole}.${String(absolute % 100).padStart(2, "0")}`;
}

/** Dirección que lleva el QR: cualquiera puede abrirla para comprobar que el recibo es auténtico. */
export function verificationUrl(publicBaseUrl: string, code: string): string {
  return `${publicBaseUrl.replace(/\/+$/, "")}/verificar/${encodeURIComponent(code)}`;
}

/** Dibuja el recibo en un PDF tamaño media carta con un QR de verificación. */
export async function renderReceiptPdf(receipt: ReceiptView, publicBaseUrl: string): Promise<Buffer> {
  const qr = await QRCode.toBuffer(verificationUrl(publicBaseUrl, receipt.verificationCode), {
    margin: 1,
    width: 220,
    errorCorrectionLevel: "M",
  });

  const document = new PDFDocument({
    size: "A5",
    margin: 36,
    info: {
      Title: `Recibo ${receipt.folio}`,
      Author: receipt.organizationName,
      Subject: `Pago del préstamo ${receipt.loanCode}`,
    },
  });
  const chunks: Buffer[] = [];
  document.on("data", (chunk: Buffer) => chunks.push(chunk));
  const finished = new Promise<Buffer>((resolve, reject) => {
    document.on("end", () => resolve(Buffer.concat(chunks)));
    document.on("error", reject);
  });

  const left = document.page.margins.left;
  const width = document.page.width - left - document.page.margins.right;

  document.fillColor("#0f3d3e").font("Helvetica-Bold").fontSize(16).text(receipt.organizationName, left, 36);
  document.fillColor("#555").font("Helvetica").fontSize(9).text("Recibo de pago", left, 56);
  document
    .fillColor("#0f3d3e")
    .font("Helvetica-Bold")
    .fontSize(14)
    .text(receipt.folio, left, 36, { width, align: "right" });
  document.fillColor("#555").font("Helvetica").fontSize(9).text(longDate(receipt.issuedOn), left, 56, { width, align: "right" });

  document.moveTo(left, 76).lineTo(left + width, 76).strokeColor("#cfd8d8").stroke();

  const rows: Array<[string, string]> = [
    ["Recibimos de", receipt.borrowerName],
    ["Préstamo", receipt.loanCode],
    ["Fecha del pago", longDate(receipt.receivedOn)],
    ["Forma de pago", METHOD_LABELS[receipt.method] ?? receipt.method],
  ];
  if (receipt.reference) {
    rows.push(["Referencia", receipt.reference]);
  }
  let y = 88;
  for (const [label, value] of rows) {
    document.fillColor("#777").font("Helvetica").fontSize(9).text(label, left, y, { width: 100 });
    document.fillColor("#111").font("Helvetica-Bold").fontSize(10).text(value, left + 104, y - 1, { width: width - 104 });
    y += 18;
  }

  y += 6;
  document.roundedRect(left, y, width, 46, 6).fillColor("#eef5f4").fill();
  document.fillColor("#555").font("Helvetica").fontSize(9).text("Monto recibido", left + 12, y + 8);
  document.fillColor("#0f3d3e").font("Helvetica-Bold").fontSize(20).text(lempiras(receipt.amountCents), left + 12, y + 20, {
    width: width - 24,
  });
  y += 60;

  document.fillColor("#777").font("Helvetica-Bold").fontSize(9).text("Cómo se aplicó el pago", left, y);
  y += 14;
  const breakdown: Array<[string, number]> = [
    ["Mora", receipt.allocation.lateFeeCents],
    ["Interés", receipt.allocation.interestCents],
    ["Capital", receipt.allocation.principalCents],
  ];
  for (const [label, cents] of breakdown) {
    document.fillColor("#333").font("Helvetica").fontSize(9).text(label, left, y);
    document.text(lempiras(cents), left, y, { width: 150, align: "right" });
    y += 13;
  }
  document.fillColor("#333").font("Helvetica-Bold").fontSize(9).text("Saldo del préstamo", left, y + 4);
  document.text(lempiras(receipt.loanBalanceCents), left, y + 4, { width: 150, align: "right" });

  document.image(qr, left + width - 96, y - 40, { width: 96 });
  document
    .fillColor("#777")
    .font("Helvetica")
    .fontSize(7)
    .text("Escanea para verificar", left + width - 96, y + 58, { width: 96, align: "center" });

  document
    .fillColor("#999")
    .fontSize(7)
    .text(`Código de verificación: ${receipt.verificationCode}`, left, document.page.height - 52, { width });

  if (receipt.voided) {
    document.save();
    document.rotate(-20, { origin: [document.page.width / 2, document.page.height / 2] });
    document
      .fillColor("#b3261e")
      .opacity(0.25)
      .font("Helvetica-Bold")
      .fontSize(54)
      .text("ANULADO", 0, document.page.height / 2 - 30, { width: document.page.width, align: "center" });
    document.restore();
  }

  document.end();
  return finished;
}
