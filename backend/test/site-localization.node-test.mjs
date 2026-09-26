import test from 'node:test';
import assert from 'node:assert/strict';
import {displayStrings,validateSiteTranslation,translateSiteTexts} from '../site-localization.mjs';
test('site translations include visible attributions but never evidence quotes, URLs or machine states',()=>{
  const texts=displayStrings({title:'Пропал человек',participants:[{status:'wanted',label:'Мужчина',note:'35 лет'}],context:[{text:'По словам очевидца',evidence:[{attribution:'со слов знакомого',quote:'PRIVATE EVIDENCE'}]}],evidence:[{text:'RAW ORIGINAL'}],sourceUrl:'https://example.test/'});
  assert.ok(texts.includes('со слов знакомого'));assert.ok(texts.includes('35 лет'));assert.ok(!texts.includes('wanted'));assert.ok(!texts.includes('RAW ORIGINAL'));assert.ok(!texts.includes('PRIVATE EVIDENCE'));
});
test('site translation validation rejects omitted text, number changes, and wrong language',async()=>{
  const strings={s0:'35 лет'};
  assert.throws(()=>validateSiteTranslation({language:'en',strings:{}},'en',strings),/paths/);
  assert.throws(()=>validateSiteTranslation({language:'en',strings:{s0:'36 years'}},'en',strings),/numbers/);
  assert.throws(()=>validateSiteTranslation({language:'hu',strings:{s0:'35 éves'}},'en',strings));
  const calls=[];const model={json:async(stage,payload,options)=>{calls.push([stage,payload.language]);return options.validate({language:payload.language,strings:{s0:payload.language==='en'?'35 years old':'35 éves'}});}};
  const result=await translateSiteTexts(model,['35 лет']);assert.equal(result.en['35 лет'],'35 years old');assert.equal(result.hu['35 лет'],'35 éves');assert.deepEqual(calls,[['site-translate','en'],['site-translate','hu']]);
});
