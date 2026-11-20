import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRecapQuery } from '../src/recap-query.ts';
import { getDailyRecap } from '../src/recap-api.ts';

test('empty date and search delegate the office date to server',()=>{
 const query=buildRecapQuery({selectedDate:'',search:'',page:1,pageSize:10});
 assert.deepEqual(query,{page:1,pageSize:10});
 assert.equal(Object.hasOwn(query,'date'),false);
 assert.equal(Object.hasOwn(query,'q'),false);
});
test('date and search are forwarded together without modifying calendar date',()=>{
 const query=buildRecapQuery({selectedDate:'2026-11-19',search:'  A & B  ',page:2,pageSize:20});
 assert.deepEqual(query,{date:'2026-11-19',q:'A & B',page:2,pageSize:20});
});
test('server pagination parameters are included for sizes 10, 20 and 50',()=>{
 for(const size of [10,20,50]){
  const query=buildRecapQuery({selectedDate:'2026-11-19',search:'name',page:3,pageSize:size});
  assert.equal(query.page,3);
  assert.equal(query.pageSize,size);
 }
});
test('search supports UTF-8, literal punctuation and whitespace without regex',()=>{
 const query=buildRecapQuery({selectedDate:'',search:'  Áditya + QA_2026  ',page:1,pageSize:10});
 assert.equal(query.q,'Áditya + QA_2026');
});
test('query builder does not mutate the local filter state',()=>{
 const state=Object.freeze({selectedDate:'2026-11-19',search:' member ',page:7,pageSize:50});
 buildRecapQuery(state);
 assert.equal(state.search,' member ');
 assert.equal(state.page,7);
});
test('date and search are encoded into the actual GET request',async t=>{
 const mock=t.mock.method(globalThis,'fetch',async(url,init)=>{
  const params=new URL(url,'http://localhost').searchParams;
  assert.equal(params.get('action'),'daily-recap');
  assert.equal(params.get('date'),'2026-11-19');
  assert.equal(params.get('q'),'Áditya + QA');
  assert.equal(params.get('page'),'4');
  assert.equal(params.get('pageSize'),'50');
  assert.equal(init.method,'GET');
  assert.equal(init.cache,'no-store');
  return Response.json({date:'2026-11-19',rows:[],total:0,page:1,pageSize:50,totalPages:1});
 });
 const query=buildRecapQuery({selectedDate:'2026-11-19',search:' Áditya + QA ',page:4,pageSize:50});
 const response=await getDailyRecap(query);
 assert.equal(response.total,0);
 assert.equal(mock.mock.callCount(),1);
});
test('reset to empty date uses server office date on the next GET',async t=>{
 const mock=t.mock.method(globalThis,'fetch',async(url)=>{
  const params=new URL(url,'http://localhost').searchParams;
  assert.equal(params.has('date'),false);
  assert.equal(params.has('q'),false);
  return Response.json({date:'2026-11-20',rows:[],total:0,page:1,pageSize:10,totalPages:1});
 });
 const query=buildRecapQuery({selectedDate:'',search:'',page:1,pageSize:10});
 const result=await getDailyRecap(query);
 assert.equal(result.date,'2026-11-20');
 assert.equal(mock.mock.callCount(),1);
});
