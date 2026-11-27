import { lempirasInWords, Money } from "@app/domain";
import PDFDocument from "pdfkit";
import { longDate } from "../../collections/infrastructure/receipt-pdf";
import type { ContractData } from "../application/contract-queries";

const FREQUENCY_TEXT: Record<string, { plural: string; period: string }> = {
  WEEKLY: { plural: "semanales", period: "semanal" },
  BIWEEKLY: { plural: "quincenales", period: "quincenal" },
  MONTHLY: { plural: "mensuales", period: "mensual" },
};

const METHOD_TEXT: Record<string, string> = {
  FLAT: "interés fijo calculado sobre el capital original",
  DECLINING: "interés sobre saldo con cuota nivelada",
  INTEREST_ONLY: "pago de solo interés con el capital en la última cuota",
};

const money = (cents: number) => Money.fromCents(cents).format();
const percent = (basisPoints: number) => `${(basisPoints / 100).toFixed(2)} %`;

/**
 * Contrato de préstamo y pagaré ya llenados con los datos del cliente aprobado (reemplazan la plantilla de
 * Word en blanco). El texto legal es un BORRADOR: debe ser validado por un abogado antes de usarse con clientes
 * reales; por eso cada página lo dice al pie.
 */
export function renderContractPdf(data: ContractData): Promise<Buffer> {
  const document = new PDFDocument({
    size: "LETTER",
    margins: { top: 56, bottom: 64, left: 64, right: 64 },
    info: { Title: `Contrato ${data.loanCode}`, Author: data.organizationName, Subject: "Contrato de préstamo y pagaré" },
    bufferPages: true,
  });
  const chunks: Buffer[] = [];
  document.on("data", (chunk: Buffer) => chunks.push(chunk));
  const finished = new Promise<Buffer>((resolve, reject) => {
    document.on("end", () => resolve(Buffer.concat(chunks)));
    document.on("error", reject);
  });

  const frequency = FREQUENCY_TEXT[data.paymentFrequency] ?? { plural: data.paymentFrequency.toLowerCase(), period: "" };
  const ratePeriod = FREQUENCY_TEXT[data.ratePeriod]?.period ?? data.ratePeriod.toLowerCase();
  const principal = Money.fromCents(data.principalCents);
  const width = document.page.width - document.page.margins.left - document.page.margins.right;
  const left = document.page.margins.left;

  const heading = (text: string) => {
    document.moveDown(0.8).font("Helvetica-Bold").fontSize(11).fillColor("#0f3d3e").text(text).moveDown(0.25);
    document.font("Helvetica").fontSize(10).fillColor("#111");
  };
  const paragraph = (text: string) => document.font("Helvetica").fontSize(10).fillColor("#111").text(text, { align: "justify" }).moveDown(0.4);

  // ---------- Contrato ----------
  document.font("Helvetica-Bold").fontSize(16).fillColor("#0f3d3e").text("CONTRATO DE PRÉSTAMO", { align: "center" });
  document.font("Helvetica").fontSize(10).fillColor("#555").text(`${data.organizationName} · Préstamo ${data.loanCode} · ${longDate(data.issuedOn)}`, { align: "center" });
  document.moveDown(1);

  paragraph(
    `Entre ${data.organizationName}, en adelante EL ACREEDOR, y ${data.borrower.fullName}, con DNI ${data.borrower.nationalId}` +
      `${data.borrower.address ? `, con domicilio en ${data.borrower.address}` : ""}` +
      `${data.borrower.phone ? ` y teléfono ${data.borrower.phone}` : ""}, en adelante EL DEUDOR, se celebra el presente contrato de préstamo, que se rige por las siguientes cláusulas:`,
  );

  heading("PRIMERA: Monto");
  paragraph(`EL ACREEDOR entrega a EL DEUDOR, y este recibe a su satisfacción, la cantidad de ${money(data.principalCents)} (${lempirasInWords(principal).toLowerCase()}).`);

  heading("SEGUNDA: Interés");
  paragraph(
    `El préstamo devenga un interés del ${percent(data.rateBp)} ${ratePeriod}, bajo la modalidad de ${METHOD_TEXT[data.interestMethod] ?? data.interestMethod}. ` +
      `La tasa efectiva anual (TEA) resultante del conjunto de cuotas es del ${percent(data.aprBp)}.`,
  );

  heading("TERCERA: Forma de pago");
  paragraph(
    `EL DEUDOR pagará en ${data.installments.length} cuota${data.installments.length === 1 ? "" : "s"} ${frequency.plural}, a partir del ${longDate(data.installments[0]?.dueDate ?? data.startDate)}, ` +
      `por un total de ${money(data.totalToPayCents)}, según el siguiente plan de pagos:`,
  );

  // Plan de pagos
  const columns = [40, 130, 100, 100, 100];
  const header = ["#", "Fecha de pago", "Capital", "Interés", "Cuota"];
  const drawRow = (cells: string[], bold = false) => {
    if (document.y > document.page.height - document.page.margins.bottom - 24) {
      document.addPage();
    }
    const y = document.y;
    let x = left;
    document.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(9).fillColor("#111");
    cells.forEach((cell, index) => {
      document.text(cell, x, y, { width: columns[index]! - 6, align: index < 2 ? "left" : "right", lineBreak: false });
      x += columns[index]!;
    });
    document.y = y + 15;
    document.moveTo(left, document.y - 2).lineTo(left + width, document.y - 2).strokeColor("#dde5e5").stroke();
  };
  drawRow(header, true);
  data.installments.forEach((item) =>
    drawRow([String(item.number), longDate(item.dueDate), money(item.principalCents), money(item.interestCents), money(item.totalCents)]),
  );
  document.x = left;
  document.moveDown(0.6);

  heading("CUARTA: Mora");
  paragraph(
    data.lateFee.type === "NONE"
      ? "Las partes no pactan cargos por mora."
      : `Si EL DEUDOR no paga una cuota en su fecha, se cobrará un cargo por mora de: ${data.lateFeeDescription.toLowerCase()}. ` +
          `Los pagos se aplican primero a la mora, luego al interés y por último al capital, empezando por la cuota más antigua.`,
  );

  heading("QUINTA: Recibos");
  paragraph("EL ACREEDOR emitirá un recibo por cada pago recibido, con un código de verificación que puede comprobarse escaneando el código QR impreso en él.");

  heading("SEXTA: Pagaré");
  paragraph("Como garantía de pago, EL DEUDOR suscribe junto a este contrato un pagaré por el monto del préstamo, que se adjunta en la página siguiente.");

  document.moveDown(2);
  const signY = Math.min(document.y + 20, document.page.height - 150);
  document.moveTo(left, signY).lineTo(left + 200, signY).strokeColor("#111").stroke();
  document.moveTo(left + width - 200, signY).lineTo(left + width, signY).stroke();
  document.font("Helvetica").fontSize(9).fillColor("#111");
  document.text("EL ACREEDOR", left, signY + 4, { width: 200, align: "center" });
  document.text(data.organizationName, left, signY + 16, { width: 200, align: "center" });
  document.text("EL DEUDOR", left + width - 200, signY + 4, { width: 200, align: "center" });
  document.text(data.borrower.fullName, left + width - 200, signY + 16, { width: 200, align: "center" });

  // ---------- Pagaré ----------
  document.addPage();
  document.font("Helvetica-Bold").fontSize(18).fillColor("#0f3d3e").text("PAGARÉ", { align: "center" });
  document.moveDown(0.6).font("Helvetica-Bold").fontSize(14).fillColor("#111").text(`Por ${money(data.principalCents)}`, { align: "center" });
  document.moveDown(1.2);
  paragraph(
    `Yo, ${data.borrower.fullName}, con DNI ${data.borrower.nationalId}, debo y pagaré incondicionalmente a ${data.organizationName}, o a su orden, ` +
      `la suma de ${lempirasInWords(principal)}, más los intereses pactados en el contrato de préstamo ${data.loanCode}, ` +
      `en las fechas y cuotas indicadas en dicho contrato.`,
  );
  paragraph("En caso de incumplimiento, EL DEUDOR reconoce que el saldo pendiente se vuelve exigible en su totalidad.");
  paragraph(`Lugar y fecha: ______________________, ${longDate(data.issuedOn)}.`);
  document.moveDown(3);
  const lineY = document.y;
  document.moveTo(left + width - 230, lineY).lineTo(left + width, lineY).strokeColor("#111").stroke();
  document.font("Helvetica").fontSize(9).text("Firma de EL DEUDOR", left + width - 230, lineY + 4, { width: 230, align: "center" });
  document.text(data.borrower.fullName, left + width - 230, lineY + 16, { width: 230, align: "center" });

  // Pie de todas las páginas.
  const range = document.bufferedPageRange();
  for (let index = range.start; index < range.start + range.count; index++) {
    document.switchToPage(index);
    document
      .font("Helvetica")
      .fontSize(7.5)
      .fillColor("#8a5a00")
      .text(
        `Texto ${data.templateVersion}: modelo pendiente de revisión legal. No usar con clientes reales hasta que un abogado lo apruebe.`,
        left,
        document.page.height - 44,
        { width, align: "center", lineBreak: false },
      );
  }

  document.end();
  return finished;
}
