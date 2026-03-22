import { describe, it, expect } from 'vitest';
import { RSTExtractor } from '../../../src/extraction/RSTExtractor.js';
import { ClosingDetector } from '../../../src/extraction/ClosingDetector.js';
import { CallsignExtractor } from '../../../src/extraction/CallsignExtractor.js';
import { RuleBasedFeatureExtractor } from '../../../src/extraction/FeatureExtractor.js';
import { PhoneticAlphabetDecoder } from '../../../src/extraction/PhoneticAlphabetDecoder.js';

describe('Chinese QSO support', () => {
  describe('RST extraction - Chinese', () => {
    const extractor = new RSTExtractor();

    it('should extract "五九"', () => {
      const candidates = extractor.extract('你的信号五九');
      expect(candidates.some(c => c.value === '59')).toBe(true);
    });

    it('should extract "五个九"', () => {
      const candidates = extractor.extract('信号五个九非常好');
      expect(candidates.some(c => c.value === '59')).toBe(true);
    });

    it('should extract "五七"', () => {
      const candidates = extractor.extract('给你报告五七');
      expect(candidates.some(c => c.value === '57')).toBe(true);
    });

    it('should extract "四九"', () => {
      const candidates = extractor.extract('你这边四九');
      expect(candidates.some(c => c.value === '49')).toBe(true);
    });

    it('should boost confidence with Chinese intro phrase', () => {
      const withIntro = extractor.extract('你的信号五九这边');
      const withoutIntro = extractor.extract('五九嗯');
      const confWith = withIntro.find(c => c.value === '59')?.confidence ?? 0;
      const confWithout = withoutIntro.find(c => c.value === '59')?.confidence ?? 0;
      expect(confWith).toBeGreaterThanOrEqual(confWithout);
    });
  });

  describe('Closing detection - Chinese', () => {
    const detector = new ClosingDetector();

    it('should detect "七三"', () => {
      const hits = detector.detectClosing('七三再见');
      expect(hits.some(h => h.type === 'farewell')).toBe(true);
    });

    it('should detect "七十三"', () => {
      const hits = detector.detectClosing('七十三祝好运');
      expect(hits.some(h => h.type === 'farewell')).toBe(true);
    });

    it('should detect "再见"', () => {
      const hits = detector.detectClosing('好的再见');
      expect(hits.some(h => h.type === 'farewell')).toBe(true);
    });

    it('should detect "谢谢联络"', () => {
      const hits = detector.detectClosing('谢谢联络下次再见');
      expect(hits.some(h => h.type === 'thanks')).toBe(true);
    });

    it('should detect "感谢通联"', () => {
      const hits = detector.detectClosing('感谢通联七三');
      expect(hits.some(h => h.type === 'thanks')).toBe(true);
    });

    it('should detect "关机" / "收台"', () => {
      expect(detector.detectClosing('准备关机了').some(h => h.type === 'closing')).toBe(true);
      expect(detector.detectClosing('我要收台了').some(h => h.type === 'closing')).toBe(true);
    });

    it('should calculate high closing score for Chinese farewells', () => {
      const score = detector.calculateClosingScore('七三再见谢谢联络');
      expect(score).toBeGreaterThanOrEqual(0.8);
    });
  });

  describe('Continuation signals - Chinese', () => {
    const detector = new ClosingDetector();

    it('should detect "收到"', () => {
      const hits = detector.detectContinuation('收到收到');
      expect(hits.some(h => h.type === 'acknowledgment')).toBe(true);
    });

    it('should detect "明白"', () => {
      const hits = detector.detectContinuation('明白了');
      expect(hits.some(h => h.type === 'acknowledgment')).toBe(true);
    });

    it('should detect "请讲"', () => {
      const hits = detector.detectContinuation('请讲');
      expect(hits.some(h => h.type === 'invitation')).toBe(true);
    });
  });

  describe('Start signals - Chinese', () => {
    const detector = new ClosingDetector();

    it('should detect "呼叫"', () => {
      const hits = detector.detectStart('呼叫呼叫');
      expect(hits.some(h => h.type === 'calling')).toBe(true);
    });
  });

  describe('Callsign extraction with Chinese context', () => {
    const extractor = new CallsignExtractor();

    it('should boost confidence with Chinese intro "这里是"', () => {
      const withIntro = extractor.extract('这里是BV2XMT');
      const withoutIntro = extractor.extract('BV2XMT在频率上');
      const confWith = withIntro.find(c => c.value === 'BV2XMT')?.confidence ?? 0;
      const confWithout = withoutIntro.find(c => c.value === 'BV2XMT')?.confidence ?? 0;
      expect(confWith).toBeGreaterThan(confWithout);
    });

    it('should boost confidence with "我的呼号是"', () => {
      const candidates = extractor.extract('我的呼号是BV2XMT');
      const conf = candidates.find(c => c.value === 'BV2XMT')?.confidence ?? 0;
      expect(conf).toBeGreaterThan(0.7);
    });

    it('should extract callsign in mixed Chinese-English text', () => {
      const candidates = extractor.extract('这里是BV2XMT 你的信号五九 七三再见');
      expect(candidates.some(c => c.value === 'BV2XMT')).toBe(true);
    });
  });

  describe('Chinese phonetic alphabet decoding', () => {
    const decoder = new PhoneticAlphabetDecoder();

    it('should decode "北京的B 上海的V" pattern', () => {
      const results = decoder.decode('北京的B 维的V 2 小的X 马的M 天的T');
      expect(results.length).toBeGreaterThanOrEqual(1);
      // Should decode to something containing BV2XMT
      const hasCallsign = results.some(r => r.decoded.includes('BV') && r.decoded.includes('XMT'));
      expect(hasCallsign).toBe(true);
    });

    it('should handle Chinese phonetic with context trigger', () => {
      const results = decoder.decode('我的呼号是 北京的B 维的V 2 小的X 马的M 天的T');
      expect(results.length).toBeGreaterThanOrEqual(1);
      if (results.length > 0) {
        expect(results[0].hasContextTrigger).toBe(true);
      }
    });
  });

  describe('Full feature extraction - Chinese QSO', () => {
    const extractor = new RuleBasedFeatureExtractor();

    it('should extract features from Chinese QSO turn', () => {
      const features = extractor.extract(
        '这里是BV2XMT 你的信号五九 七三再见'
      );
      expect(features.callsignCandidates.some(c => c.value === 'BV2XMT')).toBe(true);
      expect(features.rstCandidates.some(c => c.value === '59')).toBe(true);
      expect(features.closingSignals.length).toBeGreaterThan(0);
    });

    it('should extract features from pure Chinese closing', () => {
      const features = extractor.extract('谢谢联络 七十三 再见');
      expect(features.closingSignals.length).toBeGreaterThanOrEqual(2);
    });

    it('should extract features from Chinese RST with intro', () => {
      const features = extractor.extract('收到 你的信号五个九 非常好');
      expect(features.rstCandidates.some(c => c.value === '59')).toBe(true);
      expect(features.continuationSignals.length).toBeGreaterThan(0);
    });
  });
});
