import { DatabaseSync } from 'node:sqlite';
import { submitAbsence,transitionAbsence } from '../../server/absence-service.mjs';
import { commitAttendance } from '../../server/attendance-write.mjs';

const job=JSON.parse(process.argv[2]);
const db=new DatabaseSync(job.file);
db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=10000;');
const now=new Date(job.now);
const auth=()=>db.prepare('SELECT * FROM members WHERE user_id=? AND active=1').get(job.actor);
process.once('message',message=>{
 if(message!=='go'){db.close();process.disconnect();return;}
 let result;
 process.send({phase:'attempt'});
 try{
  let value;
  if(job.operation==='submit')value=submitAbsence(db,job.actor,job.input,job.policy,now);
  else if(job.operation==='attendance')value=commitAttendance(db,job.input,auth,()=>now);
  else if(job.operation==='transition')value=transitionAbsence(db,job.actor,job.id,job.action,job.reason,job.policy,now);
  else throw new Error('Unknown test operation.');
  result={ok:true,value};
 }catch(error){result={ok:false,status:error.status??null,message:error.message};}
 finally{db.close();}
 process.send({phase:'result',result},()=>process.disconnect());
});
process.send({phase:'ready'});
