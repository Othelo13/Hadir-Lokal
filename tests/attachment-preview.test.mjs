import test from 'node:test';
import assert from 'node:assert/strict';
import { makeAttachmentPreviewBlob } from '../src/attachment-preview.ts';

function arrayBuffer(buffer) {
  return buffer.buffer.slice(buffer.byteOffset,buffer.byteOffset+buffer.byteLength);
}
const pdf=Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF\n');
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jD4sAAAAASUVORK5CYII=','base64');
const jpeg=Buffer.from([0xff,0xd8,0xff,0xe0,0xff,0xd9]);

test('PDF preview reconstructs correct MIME from authenticated metadata, independent of HTTP headers',async()=>{
 const blob=makeAttachmentPreviewBlob(arrayBuffer(pdf),'application/pdf',pdf.length);
 assert.equal(blob.type,'application/pdf');
 assert.deepEqual(Buffer.from(await blob.arrayBuffer()),pdf);
});
test('image attachments remain previewable',()=>{
 for(const [file,mime] of [[png,'image/png'],[jpeg,'image/jpeg']]){
  const blob=makeAttachmentPreviewBlob(arrayBuffer(file),mime,file.length);
  assert.equal(blob.type,mime);
 }
});
test('a fake PDF of the same length cannot be shown as a PDF',()=>{
 const fake=Buffer.alloc(pdf.length,65);
 assert.throws(()=>makeAttachmentPreviewBlob(arrayBuffer(fake),'application/pdf',fake.length),/Isi lampiran/);
 assert.throws(()=>makeAttachmentPreviewBlob(arrayBuffer(png),'application/pdf',png.length),/Isi lampiran/);
});
test('reject truncated, oversized, unknown and incorrectly labelled attachment preview bytes',()=>{
 assert.throws(()=>makeAttachmentPreviewBlob(arrayBuffer(pdf),'application/pdf',pdf.length+1),/Ukuran lampiran/);
 assert.throws(()=>makeAttachmentPreviewBlob(arrayBuffer(pdf),'application/zip',pdf.length),/Isi lampiran/);
 assert.throws(()=>makeAttachmentPreviewBlob(arrayBuffer(pdf),'application/pdf',5*1024*1024+1),/Ukuran lampiran/);
 assert.throws(()=>makeAttachmentPreviewBlob(arrayBuffer(pdf.subarray(0,8)),'application/pdf',8),/Isi lampiran/);
});
