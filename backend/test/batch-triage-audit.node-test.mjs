import test from 'node:test';
import assert from 'node:assert/strict';
import {validateBatch} from '../batch-triage-audit.mjs';
const articles=[{id:1,title:'Fatal crash',text:'A person died.'},{id:2,title:'Nonfatal crash',text:'Nobody died.'}];
const yes={id:1,keep:true,reason:'Fatality',quote:'A person died.'},wait={id:2,keep:true,defer:true,reason:'No death',quote:'Nobody died.'};
test('batch response must cover every exact ID, with quotes from the matching source',()=>{
 assert.equal(validateBatch({decisions:[wait,yes]},articles).length,2);
 for(const decisions of [[yes],[yes,yes],[yes,{...wait,id:3}],[yes,{...wait,quote:yes.quote}],[yes,{...wait,paragraphIds:[999]}]])assert.throws(()=>validateBatch({decisions},articles));
});
