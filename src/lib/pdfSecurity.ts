/** PDF encryption is declared in its trailer; encrypted PDFs cannot be previewed without their owner password. */
export function isPasswordProtectedPdf(bytes: ArrayBuffer | Uint8Array): boolean {
  return /\/Encrypt(?:\s|\/|\d)/.test(new TextDecoder("latin1").decode(bytes));
}
