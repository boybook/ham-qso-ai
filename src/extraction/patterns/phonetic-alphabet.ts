/**
 * NATO/ICAO phonetic alphabet mapping.
 * Maps phonetic words to their corresponding letters.
 */
export const NATO_PHONETIC: Record<string, string> = {
  ALFA: 'A', ALPHA: 'A',
  BRAVO: 'B',
  CHARLIE: 'C',
  DELTA: 'D',
  ECHO: 'E',
  FOXTROT: 'F',
  GOLF: 'G',
  HOTEL: 'H',
  INDIA: 'I',
  JULIET: 'J', JULIETT: 'J',
  KILO: 'K',
  LIMA: 'L',
  MIKE: 'M',
  NOVEMBER: 'N',
  OSCAR: 'O',
  PAPA: 'P',
  QUEBEC: 'Q',
  ROMEO: 'R',
  SIERRA: 'S',
  TANGO: 'T',
  UNIFORM: 'U',
  VICTOR: 'V',
  WHISKEY: 'W', WHISKY: 'W',
  XRAY: 'X', 'X-RAY': 'X',
  YANKEE: 'Y',
  ZULU: 'Z',
};

/**
 * ITU phonetic alphabet variants (some operators use these).
 */
export const ITU_PHONETIC: Record<string, string> = {
  AMSTERDAM: 'A',
  BALTIMORE: 'B',
  CANADA: 'C',
  DENMARK: 'D',
  EDISON: 'E',
  FLORIDA: 'F',
  GALLIPOLI: 'G',
  HAVANA: 'H',
  ITALY: 'I',
  JERUSALEM: 'J',
  KILOWATT: 'K',
  LIVERPOOL: 'L',
  MADAGASCAR: 'M',
  NORWAY: 'N',
  ONTARIO: 'O',
  PORTUGAL: 'P',
  SANTIAGO: 'S',
  TRIPOLI: 'T',
  URUGUAY: 'U',
  VALENCIA: 'V',
  WASHINGTON: 'W',
  YOKOHAMA: 'Y',
  ZANZIBAR: 'Z',
};

/**
 * Common non-standard / colloquial phonetic variants used by ham operators.
 * Includes common ASR misrecognitions.
 */
export const COLLOQUIAL_PHONETIC: Record<string, string> = {
  // Common alternatives
  ABLE: 'A', ADAM: 'A', AMERICA: 'A',
  BAKER: 'B', BOY: 'B', BOSTON: 'B',
  CANDY: 'C', CAT: 'C',
  DAVID: 'D', DOG: 'D',
  EASY: 'E', EDWARD: 'E',
  FRANK: 'F', FOX: 'F', FREDDIE: 'F',
  GEORGE: 'G',
  HENRY: 'H', HARRY: 'H', HOW: 'H',
  IDA: 'I', ITEM: 'I',
  JOHN: 'J', JIG: 'J', JACK: 'J',
  KING: 'K',
  LOVE: 'L', LOUIS: 'L', LONDON: 'L', LARRY: 'L',
  MARY: 'M', MEXICO: 'M',
  NANCY: 'N', NORA: 'N',
  OCEAN: 'O', OBOE: 'O',
  PETER: 'P', PAUL: 'P',
  QUEEN: 'Q',
  RADIO: 'R', ROGER: 'R', ROBERT: 'R',
  SUGAR: 'S', SAM: 'S', SANTIAGO: 'S',
  THOMAS: 'T', TOM: 'T',
  UNION: 'U', UNCLE: 'U',
  VICTORIA: 'V',
  WILLIAM: 'W',
  YOUNG: 'Y',
  ZEBRA: 'Z',

  // ASR common misrecognitions of NATO words
  ALFA: 'A', // Already in NATO but common ASR output
  JULLIETT: 'J',
};

/**
 * Phonetic number words.
 */
export const PHONETIC_NUMBERS: Record<string, string> = {
  ZERO: '0', 'OH': '0',
  ONE: '1', WUN: '1',
  TWO: '2', TOO: '2',
  THREE: '3', TREE: '3', // Military/aviation variant
  FOUR: '4', FOWER: '4', // Military variant
  FIVE: '5', FIFE: '5', // Military variant
  SIX: '6',
  SEVEN: '7',
  EIGHT: '8', AIT: '8',
  NINE: '9', NINER: '9', LINER: '9', // "LINER" = common ASR misrecognition of "NINER"
};

/**
 * Combined phonetic map: all systems merged (NATO takes priority).
 */
export const ALL_PHONETIC: Record<string, string> = {
  ...COLLOQUIAL_PHONETIC,
  ...ITU_PHONETIC,
  ...NATO_PHONETIC, // NATO overrides others
  ...PHONETIC_NUMBERS,
};

/**
 * Context trigger phrases that indicate the speaker is about to spell a callsign.
 */
export const CALLSIGN_CONTEXT_TRIGGERS = [
  // English
  'this is',
  'my call is',
  'my callsign is',
  'my call sign is',
  'station is',
  'calling',
  'from',
  'i am',
  "i'm",
  'suffix',
  'prefix',
  'portable',
  'the call is',
  'cq cq',
  'cq de',
  // Chinese
  '这里是',
  '我的呼号是',
  '我的呼号',
  '我是',
  '呼号是',
  '呼叫',
  '本台',
];

/**
 * Chinese phonetic spelling patterns for callsign letters.
 * Chinese operators often spell callsigns using city/word associations:
 * "北京的B" "上海的S" "广州的G" etc.
 */
export const CHINESE_LETTER_ASSOCIATIONS: Record<string, string> = {
  // Common Chinese city/word associations for letters
  '北京': 'B', '波': 'B',
  '成都': 'C', '长沙': 'C',
  '大连': 'D', '德': 'D',
  '鹅': 'E',
  '福州': 'F', '福': 'F',
  '广州': 'G', '哥': 'G',
  '杭州': 'H', '海': 'H',
  '济南': 'J', '金': 'J',
  '昆明': 'K',
  '拉萨': 'L', '兰州': 'L', '刘': 'L',
  '马': 'M', '牡丹': 'M',
  '南京': 'N', '南': 'N',
  '偶': 'O',
  '泼': 'P', '普': 'P',
  '青岛': 'Q',
  '日': 'R',
  '上海': 'S', '山': 'S',
  '天津': 'T', '他': 'T',
  '武汉': 'W', '王': 'W',
  '西安': 'X', '小': 'X',
  '烟台': 'Y', '杨': 'Y',
  '张': 'Z', '郑州': 'Z',

  // Less common but used
  '阿': 'A', '爱': 'A',
  '艾': 'I',
  '优': 'U',
  '维': 'V',
};

/**
 * Pattern to match Chinese phonetic callsign spelling like "北京的B"
 */
export const CHINESE_PHONETIC_PATTERN = /([^\s]+)的([A-Z0-9])/gi;
