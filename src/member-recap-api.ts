import type { MemberRecapFilters,MemberRecapResponse } from './member-recap-types';

export async function getMemberRecap(filters:MemberRecapFilters={},signal?:AbortSignal):Promise<MemberRecapResponse>{
 const params=new URLSearchParams({action:'member-recap'});
 if(filters.period!==undefined)params.set('period',filters.period);
 if(filters.month!==undefined)params.set('month',filters.month);
 if(filters.date!==undefined)params.set('date',filters.date);
 if(filters.q!==undefined)params.set('q',filters.q.trim());
 if(filters.page!==undefined)params.set('page',String(filters.page));
 if(filters.pageSize!==undefined)params.set('pageSize',String(filters.pageSize));
 const response=await fetch('/api/app?'+params.toString(),{
  method:'GET',credentials:'same-origin',cache:'no-store',headers:{Accept:'application/json'},signal,
 });
 const body:unknown=await response.json().catch(()=>null);
 if(!response.ok){
  const reason=body&&typeof body==='object'&&'error' in body&&typeof body.error==='string'?
   body.error:'Gagal memuat rekap anggota.';
  throw new Error(reason);
 }
 if(!body||typeof body!=='object'||Array.isArray(body)||!('rows' in body)||!Array.isArray(body.rows))
  throw new Error('Respons rekap anggota tidak valid.');
 return body as MemberRecapResponse;
}
