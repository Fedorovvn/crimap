import {describe,it,expect} from 'vitest';
import {translateContent,messages,translate} from './locale';
import {penaltyLabel} from './legal-model';
describe('language boundaries',()=>{
  it('keeps identifiers and source links unchanged even when the dictionary contains those strings',()=>{
    const data={slug:'sample',eventType:'missing-person',status:'Задержан',participants:[{status:'detained',role:'suspect',note:'Описание',sourceUrl:'https://source.test/'}]};
    const result=translateContent(data,'en',{'detained':'BROKEN','suspect':'BROKEN','missing-person':'BROKEN','Описание':'Description','https://source.test/':'BROKEN'});
    expect(result.status).toBe('Detained');expect(result.participants[0]).toEqual({status:'detained',role:'suspect',note:'Description',sourceUrl:'https://source.test/'});expect(result.eventType).toBe('missing-person');
  });
  it('has both target languages for every interface label and formats legal durations',()=>{
    for(const pair of Object.values(messages)){expect(pair).toHaveLength(2);for(const text of pair)expect(text.trim()).not.toBe('');}
    expect(translate('Всего {n} сообщений о пропаже на карте','en',{n:4})).toBe('4 missing-person reports on the map');
    expect(penaltyLabel({kind:'imprisonment',max:3,unit:'years'},'en')).toBe('up to 3 years imprisonment');
    expect(penaltyLabel({kind:'imprisonment',max:3,unit:'years'},'hu')).toBe('legfeljebb 3 év szabadságvesztés');
  });
});
