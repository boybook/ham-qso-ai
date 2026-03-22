/**
 * A typical SSB QSO between BV2XMT and W1AW.
 * Each entry represents one turn with its direction and transcribed text.
 */
export const TYPICAL_QSO = {
  myCallsign: 'BV2XMT',
  frequency: 14200000,
  mode: 'USB',
  turns: [
    {
      direction: 'tx' as const,
      text: 'CQ CQ CQ this is Bravo Victor Two X-ray Mike Tango BV2XMT calling CQ and standing by',
    },
    {
      direction: 'rx' as const,
      text: 'BV2XMT this is W1AW Whiskey One Alpha Whiskey calling',
    },
    {
      direction: 'tx' as const,
      text: 'W1AW this is BV2XMT good morning thanks for calling you are five nine here in Taiwan',
    },
    {
      direction: 'rx' as const,
      text: 'BV2XMT roger roger you are also five nine here in Connecticut my name is John QTH Newington',
    },
    {
      direction: 'tx' as const,
      text: 'Thanks John my name is Tom nice to meet you 73 and good DX',
    },
    {
      direction: 'rx' as const,
      text: '73 Tom thanks for the QSO good luck W1AW clear',
    },
  ],
  expected: {
    theirCallsign: 'W1AW',
    rstSent: '59',
    rstReceived: '59',
  },
};

/**
 * A monitor-mode QSO (listening to two other stations).
 * All turns are RX direction.
 */
export const MONITORED_QSO = {
  myCallsign: 'BV2XMT',
  frequency: 7100000,
  mode: 'LSB',
  turns: [
    {
      direction: 'rx' as const,
      text: 'CQ CQ CQ this is JA1ABC Juliet Alpha One Alpha Bravo Charlie calling CQ',
    },
    {
      direction: 'rx' as const,
      text: 'JA1ABC this is VK3DEF Victor Kilo Three Delta Echo Foxtrot',
    },
    {
      direction: 'rx' as const,
      text: 'VK3DEF this is JA1ABC good evening you are five nine in Tokyo',
    },
    {
      direction: 'rx' as const,
      text: 'JA1ABC roger you are five seven here in Melbourne 73 good DX',
    },
    {
      direction: 'rx' as const,
      text: '73 thanks for the QSO JA1ABC clear',
    },
  ],
  expected: {
    callsigns: ['JA1ABC', 'VK3DEF'],
  },
};
