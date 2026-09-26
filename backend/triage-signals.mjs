// Accent-insensitive Hungarian stems deliberately cover inflected forms. A match
// protects an article from free rejection; it is NOT proof of a fact or severity.
export const greenSignals = {
  violence: [
    'rabl', 'kirabol', 'kifoszt', 'betor', 'fosztogat', 'zsarol', 'lopas', 'tolvaj',
    'vereked', 'osszever', 'osszevert', 'megver', 'megvert', 'vertek', 'bantalmaz',
    'tamadas', 'tamado', 'megtamad', 'ratamad', 'testi sertes', 'rugdos', 'rugtak',
    'utlegel', 'megutott', 'leutott', 'brutal', 'agressziv', 'garazda',
    'kesel', 'megszur', 'leszur', 'szurkalt', 'szuras', 'szurt seb', 'vagas',
    'emberoles', 'gyilk', 'megolt', 'megoles', 'halalra vert', 'agyonvert',
    'lovoldoz', 'loves', 'ralott', 'lelott', 'fegyver', 'pisztoly', 'kes',
    'balta', 'machete', 'feszitovas', 'paprikaspray', 'gazspray',
    'fojtogat', 'megfojt', 'tusz', 'emberrab', 'elrabol', 'kenyszerit',
    'szexualis eroszak', 'megeroszak', 'szemerem', 'zaklat', 'fenyeget',
    'robbery', 'burglary', 'assault', 'stabbing', 'murder', 'shooting', 'fight',
  ],
  seriousConsequences: [
    'halalos', 'halalat', 'halala', 'halott', 'meghalt', 'elhunyt', 'hunyt el',
    'eletet veszt', 'eletuket veszt', 'eletet mar nem', 'nem lehetett megment',
    'belehalt', 'agyhal', 'holttest', 'aldozat', 'tragikus', 'tragedia',
    'eletveszely', 'eletveszelyes', 'kritikus', 'valsagos', 'sulyos', 'sulyosan',
    'sulyosan megserult', 'sulyosan serult', 'serulese sulyos', 'allapota sulyos',
    'ujraeleszt', 'ujra kellett eleszt', 'reanim', 'szivmasszazs', 'mellkaskompresszio',
    'lelegeztet', 'eszmeletlen', 'elvesztette az eszmelet', 'ontudatlan',
    'nem lelegzett', 'nem lelegzik', 'legzesleall', 'szivleall', 'keringesleall',
    'intenziv osztaly', 'mutet', 'operalt', 'koponyaser', 'agyrazkodas',
    'fejser', 'gerincser', 'medencetores', 'csonttores', 'nyilt tores', 'amput',
    'roncsol', 'csonkol', 'egett ser', 'egesi ser', 'harmadfoku', 'megegett',
    'tobb serult', 'tobben serul', 'tomeges serul', 'serulteket', 'verveszt', 'verzes',
    'fatal', 'killed', 'died', 'critical condition', 'serious injury', 'seriously injured',
    'life threatening', 'resuscitat', 'unconscious',
  ],
  dangerousAccident: [
    'mentohelikopter', 'mento helikopter', 'legimento', 'mentoegyseg',
    'rohamkocsi', 'rohammento', 'feszitovago', 'feszitovel', 'beszorult',
    'roncsok kozul', 'roncsbol', 'roncsok ala', 'kiszabadit', 'muszaki mentes',
    'tomegbaleset', 'tomegkarambol', 'frontalis', 'szembol',
    'szembejovo', 'felborult', 'felborulas', 'fejre allt', 'tobbszor atfordult',
    'kiszakadt', 'kirepult', 'kizuhant', 'kirepul', 'lesodrodott', 'szakadek',
    'elsodort', 'elgazolt', 'gazolas', 'gyalogos', 'zebran',
    'vonat ala', 'villamos ala', 'busz ala', 'kerekek ala', 'sinekre',
    'elszabadult', 'kisiklott', 'fekhiba', 'fek nelkul', 'lattam a halal',
    'tuzoltok', 'kiegett', 'kigyulladt', 'langra kapott', 'veszelyes anyag',
    'rescue helicopter', 'trapped', 'rollover', 'head on', 'extricat',
  ],
  rescueAndDanger: [
    'tuzesz', 'langol', 'langok', 'fustmergez', 'szen monoxid', 'szenmonoxid',
    'gazszivarg', 'gazrobban', 'robban', 'robbanoszer', 'bombafenyeget',
    'kiurit', 'kitelep', 'kimenekit', 'menekit', 'evakual', 'eletment',
    'mentettek ki', 'kimentettek', 'mentette meg', 'vizbe esett', 'vizbe zuhant',
    'dunaba', 'fullad', 'fuldok', 'vizbe fult', 'leszakadt', 'omlott', 'osszeoml',
    'magasbol', 'lezuhant', 'aramutes', 'mergezes', 'mergezo', 'eltunt',
    'eltunes', 'keresik', 'koroz', 'szokes', 'megszokott', 'hajsz', 'uldoz',
    'missing person', 'evacuat', 'explosion', 'collapsed', 'drowning',
  ],
  unusual: [
    'veres', 'verzo', 'verben', 'csupa ver', 'verboritotta', 'meztelen', 'felmeztelen',
    'felmasz', 'felkapaszkod', 'tetejere', 'tetejen', 'teton', 'villamoson log',
    'kapaszkodott', 'palyara rohant', 'forgalommal szemben', 'amokfut',
    'orjong', 'tombol', 'bizarr', 'furcsa', 'rendhagyo', 'szokatlan', 'sokkolo',
    'megdobbento', 'hajmereszto', 'megdob', 'dobalt', 'gyujtogat', 'tuszdrama',
    'bloody', 'bloodied', 'naked', 'unusual', 'bizarre', 'rampage',
  ],
};

export const normalizeSignal = s => String(s ?? '').normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[-–—]/g, ' ').replace(/\s+/g, ' ');
const compiled = Object.entries(greenSignals).map(([category, words]) => [category, words.map(word => new RegExp('(?:^|[^a-z])' + normalizeSignal(word).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))]);
export function positiveSignals(text) {
  const normalized = normalizeSignal(text);
  return compiled.filter(([, patterns]) => patterns.some(pattern => pattern.test(normalized))).map(([category]) => category);
}
