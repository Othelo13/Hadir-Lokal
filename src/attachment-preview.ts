/**
 * The API already authenticates, validates and hashes attachments. This last
 * client-side check ensures a binary preview really matches the type and size
 * advertised in the authenticated request detail, regardless of transport
 * Content-Type headers. Only known image/PDF blobs may be rendered.
 */
export function makeAttachmentPreviewBlob(bytes: ArrayBuffer, expectedMime: string, expectedSize: number): Blob {
  if (!Number.isSafeInteger(expectedSize) || expectedSize < 1 || expectedSize > 5 * 1024 * 1024) {
    throw new Error('Ukuran lampiran tidak valid.');
  }
  const data = new Uint8Array(bytes);
  if (data.byteLength !== expectedSize) {
    throw new Error('Ukuran lampiran dari server tidak sesuai.');
  }

  const jpeg = data.length >= 4 &&
    data[0] === 0xff && data[1] === 0xd8 &&
    data[data.length-2] === 0xff && data[data.length-1] === 0xd9;
  const pngSignature = [137,80,78,71,13,10,26,10];
  const png = data.length >= 20 &&
    pngSignature.every((byte, index) => data[index] === byte) &&
    data[data.length-8] === 73 && data[data.length-7] === 69 &&
    data[data.length-6] === 78 && data[data.length-5] === 68;
  const pdfHead = new TextDecoder('ascii').decode(data.subarray(0,16));
  const pdfTail = new TextDecoder('latin1').decode(data.subarray(Math.max(0,data.length-1024)));
  const pdf = /^%PDF-(?:1\.[0-7]|2\.0)(?:\r|\n)/.test(pdfHead) &&
    /%%EOF[\x00\t\n\f\r ]*$/.test(pdfTail);
  const valid = expectedMime === 'image/jpeg' ? jpeg :
    expectedMime === 'image/png' ? png :
    expectedMime === 'application/pdf' ? pdf : false;
  if (!valid) throw new Error('Isi lampiran tidak sesuai dengan format yang tersimpan.');

  // Construct the display blob with the server-verified type, not an arbitrary
  // MIME supplied by an intermediary or browser download response.
  return new Blob([bytes], { type: expectedMime });
}
