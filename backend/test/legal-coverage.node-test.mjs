import test from 'node:test';
import assert from 'node:assert/strict';
import {validateLegalCoverage} from '../legal-coverage.mjs';
const event={participants:[{key:'suspect-a',role:'suspect'},{key:'suspect-b',role:'suspect'},{key:'victim',role:'victim'}],legal:[{participantKey:'suspect-a'}]};
const report={status:'partial',reason:'Для второго подозреваемого не установлена роль.',participants:[{participantKey:'suspect-a',status:'mapped',reason:'Состав прямо указан полицией.'},{participantKey:'suspect-b',status:'insufficient-facts',reason:'Не установлены действия этого участника.'}]};
test('legal review accounts for each suspect and cannot hide missing mappings',()=>{
 assert.equal(validateLegalCoverage(report,event).status,'partial');
 assert.throws(()=>validateLegalCoverage({...report,participants:report.participants.slice(0,1)},event),/EVERY/);
 assert.throws(()=>validateLegalCoverage({...report,status:'mapped'},event),/disagrees/);
 assert.throws(()=>validateLegalCoverage({...report,participants:[...report.participants,{...report.participants[0]}]},event),/exactly once/);
 assert.throws(()=>validateLegalCoverage({...report,participants:[{...report.participants[0],participantKey:'victim'},report.participants[1]]},event),/exactly once/);
 assert.throws(()=>validateLegalCoverage({...report,participants:report.participants.map(p=>({...p,status:'mapped'}))},event),/disagrees/);
});
test('empty legal result needs a meaningful explanation rather than an implied clean bill',()=>{
 const event={participants:[],legal:[]};
 const report={status:'no-suspect',reason:'Источник сообщает о несчастном случае; действий другого человека не описано.',participants:[]};
 assert.equal(validateLegalCoverage(report,event).status,'no-suspect');
 assert.throws(()=>validateLegalCoverage(undefined,event));
 assert.throws(()=>validateLegalCoverage({...report,reason:'Нет'},event));
 assert.throws(()=>validateLegalCoverage({...report,status:'mapped'},event),/disagrees/);
});

test('absence of legal consequences cannot be asserted from source silence',()=>{
 const event={participants:[],legal:[]},report={status:'not-applicable',reason:'Полиция прямо исключила участие другого лица.',participants:[]};
 assert.throws(()=>validateLegalCoverage(report,event),/official source/);
 const quote='No crime was committed.',basis=[{documentId:'1',quote}];
 assert.doesNotThrow(()=>validateLegalCoverage({...report,basis},event,[{id:'1',text:quote,sourceKind:'official'}]));
 assert.throws(()=>validateLegalCoverage({...report,basis},event,[{id:'1',text:quote,sourceKind:'media'}]),/official source/);
});
