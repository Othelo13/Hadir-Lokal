/** Ekspor XLSX tanpa dependensi: OOXML dan ZIP tanpa kompresi (didukung Excel). */
export type AttendanceExportRecord = {
  id: string;
  user_id?: string;
  name: string;
  email: string;
  date: string;
  kind: 'in' | 'out';
  time: string;
  status: string;
  review?: string;
  cancelled?: boolean;
  reason?: string;
  cancelled_at?: string;
};

type SheetCell = { value: string | number; style?: number; formula?: string };
const cell = (value: string | number, style = 0, formula?: string): SheetCell => ({ value, style, formula });

function escapeXml(value: unknown) {
  return String(value ?? '')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/g, '')
    .slice(0, 32767)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function columnLetter(n: number) {
  let result = '';
  for (; n > 0; n = Math.floor((n - 1) / 26)) result = String.fromCharCode(65 + ((n - 1) % 26)) + result;
  return result;
}

function sheetXml(rows: SheetCell[][], widths: number[], merges: string[], filter: string) {
  const rowXml = rows.map((row, index) => {
    const r = index + 1;
    const inner = row.map((entry, col) => {
      const addr = `${columnLetter(col + 1)}${r}`;
      const style = entry.style ? ` s="${entry.style}"` : '';
      if (entry.formula) {
        return `<c r="${addr}"${style}><f>${escapeXml(entry.formula)}</f><v>${entry.value}</v></c>`;
      }
      if (typeof entry.value === 'number') return `<c r="${addr}"${style}><v>${entry.value}</v></c>`;
      return `<c r="${addr}"${style} t="inlineStr"><is><t xml:space="preserve">${escapeXml(entry.value)}</t></is></c>`;
    }).join('');
    return `<row r="${r}"${r === 1 ? ' ht="31" customHeight="1"' : ''}${r === 4 ? ' ht="25" customHeight="1"' : ''}>${inner}</row>`;
  }).join('');
  const cols = widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    `<sheetViews><sheetView showGridLines="0" workbookViewId="0"><pane ySplit="4" topLeftCell="A5" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A5" sqref="A5"/></sheetView></sheetViews>` +
    `<sheetFormatPr defaultRowHeight="19"/><cols>${cols}</cols><sheetData>${rowXml}</sheetData>` +
    `<autoFilter ref="${filter}"/><mergeCells count="${merges.length}">${merges.map(m => `<mergeCell ref="${m}"/>`).join('')}</mergeCells>` +
    `<pageMargins left="0.3" right="0.3" top="0.5" bottom="0.5" header="0.2" footer="0.2"/>` +
    `</worksheet>`;
}

const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="1"><numFmt numFmtId="164" formatCode="dd/mm/yyyy"/></numFmts>
<fonts count="4">
  <font><sz val="11"/><name val="Aptos"/><color rgb="FF243A32"/></font>
  <font><b/><sz val="16"/><name val="Aptos Display"/><color rgb="FFFFFFFF"/></font>
  <font><b/><sz val="10"/><name val="Aptos"/><color rgb="FFFFFFFF"/></font>
  <font><sz val="10"/><name val="Aptos"/><color rgb="FF68796F"/></font>
</fonts>
<fills count="5">
  <fill><patternFill patternType="none"/></fill>
  <fill><patternFill patternType="gray125"/></fill>
  <fill><patternFill patternType="solid"><fgColor rgb="FF244D3E"/><bgColor indexed="64"/></patternFill></fill>
  <fill><patternFill patternType="solid"><fgColor rgb="FFFFF0EE"/><bgColor indexed="64"/></patternFill></fill>
  <fill><patternFill patternType="solid"><fgColor rgb="FFFFF7E6"/><bgColor indexed="64"/></patternFill></fill>
</fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="8">
  <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
  <xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>
  <xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1"/>
  <xf numFmtId="0" fontId="2" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>
  <xf numFmtId="0" fontId="0" fillId="3" borderId="0" xfId="0" applyFill="1"/>
  <xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
  <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"><alignment horizontal="center"/></xf>
  <xf numFmtId="0" fontId="0" fillId="4" borderId="0" xfId="0" applyFill="1"/>
</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

const crcTable = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  crcTable[n] = c >>> 0;
}
function crc32(data: Uint8Array) {
  let crc = 0xffffffff;
  for (const b of data) crc = crcTable[(crc ^ b) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
function zip(files: { name: string; body: string }[]) {
  const enc = new TextEncoder();
  const locals: Uint8Array[] = [], centrals: Uint8Array[] = [];
  let offset = 0, centralLength = 0;
  for (const file of files) {
    const name = enc.encode(file.name), data = enc.encode(file.body), crc = crc32(data);
    const local = new Uint8Array(30 + name.length + data.length), lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(8, 0, true); // ZIP STORE: tanpa kompresi, tetap XLSX valid.
    lv.setUint32(14, crc, true);
    lv.setUint32(18, data.length, true);
    lv.setUint32(22, data.length, true);
    lv.setUint16(26, name.length, true);
    local.set(name, 30);
    local.set(data, 30 + name.length);
    locals.push(local);
    const central = new Uint8Array(46 + name.length), cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, data.length, true);
    cv.setUint32(24, data.length, true);
    cv.setUint16(28, name.length, true);
    cv.setUint32(42, offset, true);
    central.set(name, 46);
    centrals.push(central);
    offset += local.length;
    centralLength += central.length;
  }
  const end = new Uint8Array(22), ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, files.length, true);
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, centralLength, true);
  ev.setUint32(16, offset, true);
  const result = new Uint8Array(offset + centralLength + end.length);
  let p = 0;
  for (const part of [...locals, ...centrals, end]) { result.set(part, p); p += part.length; }
  return result;
}

function dateSerial(date: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return 0;
  const [y,m,d] = date.split('-').map(Number);
  return (Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / 86400000;
}
function localDateTime(iso: string | undefined, timezone: string) {
  if (!iso) return '';
  const date = new Date(iso);
  return Number.isNaN(date.valueOf()) ? '' : date.toLocaleString('id-ID', {
    timeZone: timezone, day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: false,
  });
}

/** Baris yang masuk adalah baris setelah filter tanggal/pencarian di tampilan rekap. */
export function buildAttendanceExcel(
  records: AttendanceExportRecord[],
  options: { timezone: string; dateFilter?: string; query?: string },
) {
  const { timezone } = options;
  const heads = ['Nama', 'Email', 'Tanggal', 'Jenis', 'Jam', 'Status', 'Tinjauan', 'Alasan Pembatalan', 'Dibatalkan Pada', 'ID Catatan'];
  const rekap: SheetCell[][] = [
    [cell('HADIR / REKAP ABSENSI', 1)],
    [cell(`Total ${records.length} catatan · Zona waktu: ${timezone} · Filter: ${options.dateFilter || 'Semua tanggal'}${options.query?.trim() ? ` · Pencarian: ${options.query.trim()}` : ''}`, 2)],
    [],
    heads.map(h => cell(h, 3)),
  ];
  const summary = new Map<string, { name: string; email: string; masuk: number; pulang: number; late: number; cancelled: number; rejected: number; total: number }>();
  for (const r of records) {
    const cancelled = !!r.cancelled;
    const rejected = !cancelled && r.review === 'rejected';
    const valid = !cancelled && !rejected;
    const status = cancelled ? 'Dibatalkan' : r.status === 'late' ? 'Terlambat' : 'Tepat waktu';
    const review = cancelled ? 'Dibatalkan' : r.review === 'approved' ? 'Disetujui' : r.review === 'rejected' ? 'Ditolak' : 'Menunggu tinjauan';
    const time = localDateTime(r.time, timezone).split(', ')[1] || '';
    rekap.push([
      cell(r.name), cell(r.email), cell(dateSerial(r.date), 5), cell(r.kind === 'in' ? 'Masuk' : 'Pulang'),
      cell(time), cell(status, cancelled ? 4 : status === 'Terlambat' ? 7 : 0), cell(review),
      cell(cancelled ? r.reason || '' : ''), cell(cancelled ? localDateTime(r.cancelled_at, timezone) : ''), cell(r.id),
    ]);
    const key = r.email.trim().toLowerCase();
    if (!summary.has(key)) summary.set(key, { name: r.name, email: r.email, masuk: 0, pulang: 0, late: 0, cancelled: 0, rejected: 0, total: 0 });
    const item = summary.get(key)!;
    item.total++;
    if (cancelled) item.cancelled++;
    if (rejected) item.rejected++;
    if (valid && r.kind === 'in') item.masuk++;
    if (valid && r.kind === 'out') item.pulang++;
    if (valid && r.kind === 'in' && r.status === 'late') item.late++;
  }
  const last = Math.max(5, 4 + records.length);
  const ref = (col: string) => `'Rekap Absensi'!$${col}$5:$${col}$${last}`;
  const summaryRows: SheetCell[][] = [
    [cell('HADIR / RINGKASAN KEHADIRAN', 1)],
    [cell('Berdasarkan catatan yang diekspor · Masuk/Pulang valid termasuk yang menunggu tinjauan, tidak termasuk ditolak/dibatalkan.', 2)],
    [],
    ['Nama', 'Email', 'Masuk Valid', 'Pulang Valid', 'Terlambat', 'Dibatalkan', 'Ditolak', 'Total Catatan'].map(h => cell(h, 3)),
  ];
  const members = [...summary.values()].sort((a, b) => a.name.localeCompare(b.name, 'id'));
  for (const member of members) {
    const n = summaryRows.length + 1;
    const email = `$B${n}`;
    const cnt = (conditions: string[]) => `COUNTIFS(${ref('B')},${email},${conditions.join(',')})`;
    summaryRows.push([
      cell(member.name), cell(member.email),
      cell(member.masuk, 6, cnt([`${ref('D')},"Masuk"`, `${ref('F')},"<>Dibatalkan"`, `${ref('G')},"<>Ditolak"`])),
      cell(member.pulang, 6, cnt([`${ref('D')},"Pulang"`, `${ref('F')},"<>Dibatalkan"`, `${ref('G')},"<>Ditolak"`])),
      cell(member.late, 6, cnt([`${ref('D')},"Masuk"`, `${ref('F')},"Terlambat"`, `${ref('G')},"<>Ditolak"`])),
      cell(member.cancelled, 6, cnt([`${ref('F')},"Dibatalkan"`])),
      cell(member.rejected, 6, cnt([`${ref('G')},"Ditolak"`])),
      cell(member.total, 6, `COUNTIF(${ref('B')},${email})`),
    ]);
  }
  const sheets = [
    sheetXml(rekap, [25,33,16,13,13,19,22,43,24,39], ['A1:J1','A2:J2'], `A4:J${Math.max(4, rekap.length)}`),
    sheetXml(summaryRows, [26,35,16,17,17,17,14,17], ['A1:H1','A2:H2'], `A4:H${Math.max(4, summaryRows.length)}`),
  ];
  return zip([
    { name: '[Content_Types].xml', body: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>` },
    { name: '_rels/.rels', body: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>` },
    { name: 'xl/workbook.xml', body: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Rekap Absensi" sheetId="1" r:id="rId1"/><sheet name="Ringkasan Kehadiran" sheetId="2" r:id="rId2"/></sheets><calcPr calcId="191029" fullCalcOnLoad="1"/></workbook>` },
    { name: 'xl/_rels/workbook.xml.rels', body: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>` },
    { name: 'xl/styles.xml', body: stylesXml },
    { name: 'xl/worksheets/sheet1.xml', body: sheets[0] },
    { name: 'xl/worksheets/sheet2.xml', body: sheets[1] },
  ]);
}