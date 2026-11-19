import { createHash,randomUUID } from 'node:crypto';
import jpeg from 'jpeg-js';

export const MAX_ATTACHMENT_BYTES=5*1024*1024;
export const DEFAULT_BODY_BYTES=2600000;
export const ABSENCE_BODY_BYTES=7100000;
export function bodyLimit(method,params) {
  return method==='POST' && params.get('action')==='absence-submit' ? ABSENCE_BODY_BYTES : DEFAULT_BODY_BYTES;
}
const extensions={'image/jpeg':['jpg','jpeg'],'image/png':['png'],'application/pdf':['pdf']};
function fail(message,status=400){throw Object.assign(new Error(message),{status});}
function hash(bytes){return createHash('sha256').update(bytes).digest('hex');}
function checkPNG(bytes){
  const sig=Buffer.from([137,80,78,71,13,10,26,10]);
  if(bytes.length<45 || !bytes.subarray(0,8).equals(sig))return false;
  let pos=8, first=true, idat=false;
  while(pos+12<=bytes.length){
    const size=bytes.readUInt32BE(pos), kind=bytes.toString('ascii',pos+4,pos+8);
    if(size>bytes.length-pos-12)return false;
    if(first){
      if(kind!=='IHDR'||size!==13)return false;
      const w=bytes.readUInt32BE(pos+8),h=bytes.readUInt32BE(pos+12);
      if(!w||!h||w>10000||h>10000||w*h>25000000)return false;
      first=false;
    }
    if(kind==='IDAT'&&size>0)idat=true;
    pos+=size+12;
    if(kind==='IEND')return size===0&&idat&&pos===bytes.length;
  }
  return false;
}
function checkPDF(bytes){
  return /^%PDF-(?:1\.[0-7]|2\.0)(?:\r|\n)/.test(bytes.subarray(0,16).toString('ascii')) &&
    /%%EOF[\x00\t\n\f\r ]*$/.test(bytes.subarray(-1024).toString('latin1'));
}
function checkJPEG(bytes){
  if(bytes.length<4||bytes[0]!==255||bytes[1]!==216||bytes.at(-2)!==255||bytes.at(-1)!==217)return false;
  try{
    const image=jpeg.decode(bytes,{useTArray:true,maxResolutionInMP:25,maxMemoryUsageInMB:128});
    return image.width>0&&image.height>0;
  }catch{return false;}
}
/** Validate a single JSON attachment. No client-controlled path or file key. */
export function validateAttachment(input){
  if(!input||typeof input!=='object'||Array.isArray(input))fail('Lampiran tidak valid.');
  const {name,mimeType,base64}=input;
  if(typeof name!=='string'||name.length<1||name.length>150||name!==name.trim()||
    /[\x00-\x1f\x7f/\\:]/.test(name)||name==='.'||name==='..')fail('Nama lampiran tidak valid.');
  const extension=name.split('.').at(-1).toLowerCase();
  if(typeof mimeType!=='string'||!Object.hasOwn(extensions,mimeType)||!name.includes('.')||!extensions[mimeType].includes(extension))fail('Jenis lampiran tidak didukung.');
  if(typeof base64!=='string'||base64.length===0)fail('Isi lampiran tidak valid.');
  if(base64.length>4*Math.ceil(MAX_ATTACHMENT_BYTES/3))fail('Lampiran maksimal 5 MiB.',413);
  const bytes=Buffer.from(base64,'base64');
  if(bytes.length>MAX_ATTACHMENT_BYTES)fail('Lampiran maksimal 5 MiB.',413);
  if(!bytes.length||bytes.toString('base64')!==base64)fail('Encoding lampiran tidak valid.');
  const valid=mimeType==='image/jpeg'?checkJPEG(bytes):mimeType==='image/png'?checkPNG(bytes):checkPDF(bytes);
  if(!valid)fail('Isi lampiran tidak sesuai dengan format file.');
  return {name,mimeType,bytes,sha256:hash(bytes)};
}
/** Called only within the request submission transaction. */
export function storeAttachment(sqlite,requestId,input,timestamp){
  const file=validateAttachment(input),id=randomUUID();
  sqlite.prepare(`INSERT INTO absence_attachments(id,request_id,storage_key,original_name,mime_type,file_size,sha256,created_at)
    VALUES(?,?,?,?,?,?,?,?)`).run(id,requestId,'sqlite:'+id,file.name,file.mimeType,file.bytes.length,file.sha256,timestamp);
  sqlite.prepare('INSERT INTO absence_attachment_blobs(attachment_id,content) VALUES (?,?)').run(id,file.bytes);
}
export function attachmentResponse(row){
  const bytes=Buffer.from(row.content);
  if(bytes.length!==row.file_size||hash(bytes)!==row.sha256)fail('Lampiran tidak dapat dibaca.',500);
  const ext=extensions[row.mime_type]?.[0];
  if(!ext)fail('Lampiran tidak dapat dibaca.',500);
  return new Response(bytes,{
    headers:{
      'Content-Type':row.mime_type,
      'Content-Length':String(bytes.length),
      'Content-Disposition':'attachment; filename="lampiran.'+ext+'"',
      'Cache-Control':'private, no-store',
      'X-Content-Type-Options':'nosniff',
      'Content-Security-Policy':"default-src 'none'; sandbox",
      'Cross-Origin-Resource-Policy':'same-origin',
    }
  });
}
